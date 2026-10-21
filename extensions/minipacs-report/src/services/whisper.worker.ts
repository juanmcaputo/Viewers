// Hilo aparte (Web Worker) donde vive Whisper: la carga, el precalentamiento y
// las transcripciones no traban la pantalla de OHIF. Lo crea y le habla
// SpeechTranscriber.ts; el modelo a usar lo elige la pagina (ElegirModelo.ts,
// que necesita localStorage) y llega en el mensaje 'cargar'.
//
// Mensajes que recibe:
//   { tipo: 'cargar', perfil }            carga el modelo y lo precalienta
//   { tipo: 'transcribir', id, audio }    PCM 16 kHz -> texto
// Mensajes que envia:
//   { tipo: 'listo', perfil, pedido }     modelo cargado (perfil final, puede ser
//                                         uno mas liviano si el pedido no cargo)
//   { tipo: 'progreso', fase, perfil, porcentaje }   mientras carga
//   { tipo: 'parcial', id, texto }        lo que va saliendo (palabra a palabra)
//   { tipo: 'texto', id, texto } | { tipo: 'error', id?, nombre, mensaje }

import { pipeline, WhisperTextStreamer } from '@huggingface/transformers';
import './entornoTransformers';
import { registro, advertencia, medir } from './registroVoz';
import { PerfilWhisper, perfilAnterior } from './ElegirModelo';

const OPCIONES = { language: 'spanish', task: 'transcribe' };

// Whisper a veces devuelve basura (">> >> >>", simbolos repetidos) cuando la
// placa de video calcula mal. Si casi no hay letras, se descarta el tramo.
function esBasura(texto: string): boolean {
  const sinEspacios = texto.replace(/\s/g, '');
  if (!sinEspacios) {
    return false;
  }
  const letras = (sinEspacios.match(/\p{L}/gu) || []).length;
  return letras / sinEspacios.length < 0.5;
}

let cargado: Promise<{ modelo: any; perfil: PerfilWhisper }> | null = null;
let cola: Promise<void> = Promise.resolve(); // de a una transcripcion, en orden

const enviar = (mensaje: any) => (self as any).postMessage(mensaje);
const errorComoMensaje = (error: any) => ({
  nombre: error?.name || 'Error',
  mensaje: error?.message || String(error),
});

// Progreso de la carga para el panel ("Preparando el dictado... 45 %"). La
// libreria avisa por archivo (bajado/total); se suma todo. Como mucho 4 avisos
// por segundo para no inundar la pagina de mensajes.
function seguirProgreso(perfil: PerfilWhisper) {
  const archivos = new Map<string, { bajado: number; total: number }>();
  let ultimo = 0;
  return (evento: any) => {
    if (evento?.status !== 'progress' || !evento.file || !evento.total) {
      return;
    }
    archivos.set(evento.file, { bajado: evento.loaded || 0, total: evento.total });
    const ahora = performance.now();
    if (ahora - ultimo < 250) {
      return;
    }
    ultimo = ahora;
    let bajado = 0;
    let total = 0;
    archivos.forEach(a => {
      bajado += a.bajado;
      total += a.total;
    });
    enviar({ tipo: 'progreso', fase: 'cargando', perfil, porcentaje: Math.min(99, Math.round((bajado / total) * 100)) });
  };
}

// Carga el perfil pedido; si no carga (driver, memoria, archivos que faltan)
// prueba con el anterior hasta tiny en el procesador
async function cargar(pedido: PerfilWhisper) {
  let perfil = pedido;
  for (;;) {
    try {
      const actual = perfil;
      const modelo: any = await medir(`carga de ${actual.modelo} (${actual.id})`, () =>
        (pipeline as any)('automatic-speech-recognition', actual.modelo, {
          device: actual.device,
          dtype: actual.dtype,
          progress_callback: seguirProgreso(actual),
        })
      );
      enviar({ tipo: 'progreso', fase: 'precalentando', perfil: actual, porcentaje: 99 });
      // Precalentar: la primera pasada compila los programas de la placa de video
      // (varios segundos). Se hace aca con 1 s de silencio, no en la primera frase.
      await medir(`precalentamiento de ${actual.id}`, () => modelo(new Float32Array(16000), OPCIONES));
      registro(`Whisper listo: ${perfil.id} (${perfil.device === 'webgpu' ? 'placa de video' : 'procesador'})`);
      return { modelo, perfil };
    } catch (error) {
      const anterior = perfilAnterior(perfil.id);
      if (anterior.id === perfil.id) {
        throw error;
      }
      advertencia(`no se pudo cargar ${perfil.id}, se prueba ${anterior.id}`, error);
      perfil = anterior;
    }
  }
}

self.onmessage = (evento: MessageEvent) => {
  const datos = evento.data;

  if (datos.tipo === 'cargar') {
    if (!cargado) {
      cargado = cargar(datos.perfil);
      cargado.then(
        ({ perfil }) => enviar({ tipo: 'listo', perfil, pedido: datos.perfil }),
        error => {
          cargado = null; // permitir reintento
          enviar({ tipo: 'error', ...errorComoMensaje(error) });
        }
      );
    }
    return;
  }

  if (datos.tipo === 'transcribir') {
    const { id, audio } = datos;
    cola = cola.then(async () => {
      try {
        if (!cargado) {
          throw new Error('Whisper no esta cargado');
        }
        const { modelo, perfil } = await cargado;
        const segundos = audio.length / 16000;
        const inicio = performance.now();
        // Cada palabra que genera Whisper se manda enseguida al panel: se ve
        // escribir en lugar de esperar la frase entera. No agrega trabajo.
        let parcial = '';
        const streamer = new WhisperTextStreamer(modelo.tokenizer, {
          skip_prompt: true,
          callback_function: (pedazo: string) => {
            parcial += pedazo;
            enviar({ tipo: 'parcial', id, texto: parcial.trim() });
          },
        });
        const resultado = await modelo(audio, { ...OPCIONES, streamer });
        const ms = performance.now() - inicio;
        const texto = (Array.isArray(resultado) ? resultado[0]?.text : resultado?.text) ?? '';
        // Solo la cantidad de caracteres: el texto dictado no se registra
        registro(
          `transcripcion (${perfil.id}) de ${segundos.toFixed(1)} s de audio: ${Math.round(ms)} ms`,
          `(${(ms / 1000 / segundos).toFixed(2)} x lo que dura), ${texto.trim().length} caracteres`
        );
        if (esBasura(texto)) {
          advertencia(`transcripcion descartada (${perfil.id}): salio casi sin letras, la placa calculo mal`);
          enviar({ tipo: 'texto', id, texto: '' });
          return;
        }
        enviar({ tipo: 'texto', id, texto: texto.trim() });
      } catch (error) {
        enviar({ tipo: 'error', id, ...errorComoMensaje(error) });
      }
    });
  }
};
