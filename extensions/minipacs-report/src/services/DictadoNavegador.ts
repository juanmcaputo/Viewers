// Dictado con el reconocimiento de voz PROPIO del navegador (Web Speech API) en
// modo LOCAL: processLocally = true. Chrome (155+) reconoce dentro de la PC con un
// paquete de idioma que baja una sola vez; el audio NO sale del equipo (probado
// sin internet). Si el modo local no esta, NO se usa el servidor del navegador:
// el panel sigue con Whisper (SpeechTranscriber.ts).
//
// Escribe mientras se habla: lo provisorio va al gris del panel (onParcial) y
// cada frase confirmada al cuadro (onFrase). Sirve para el microfono y para un
// MP3 (dictarArchivo). En el registro: solo tiempos y cantidades, nunca el texto.

import { registro, advertencia } from './registroVoz';

const SR = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
const IDIOMA = 'es-ES';
const OPCIONES = { langs: [IDIOMA], processLocally: true };

// 'available' (listo) | 'downloadable' | 'downloading' | 'unavailable'
export async function estadoDictadoNavegador(): Promise<string> {
  if (!SR?.available) {
    return 'unavailable'; // navegador sin modo local (ej. Edge, Firefox, Chrome viejo)
  }
  try {
    return await SR.available(OPCIONES);
  } catch {
    return 'unavailable';
  }
}

// Instala el castellano local si hace falta. Devuelve true si quedo listo.
// Chrome puede pedir un clic del usuario para instalar: por eso el panel lo
// reintenta al apretar Grabar voz si al iniciar OHIF no se pudo.
let instalando: Promise<boolean> | null = null;
export function prepararDictadoNavegador(): Promise<boolean> {
  if (!instalando) {
    instalando = (async () => {
      const estado = await estadoDictadoNavegador();
      if (estado === 'available') {
        return true;
      }
      if (estado !== 'downloadable' && estado !== 'downloading') {
        registro(`dictado del navegador: no disponible (${estado}), se usa Whisper`);
        return false;
      }
      const inicio = performance.now();
      registro('dictado del navegador: instalando castellano local...');
      const ok = await SR.install(OPCIONES).catch((error: unknown) => {
        advertencia('dictado del navegador: no se pudo instalar el castellano', error);
        return false;
      });
      const listo = ok && (await estadoDictadoNavegador()) === 'available';
      registro(`dictado del navegador: instalacion ${listo ? 'lista' : 'fallida'} en ${Math.round(performance.now() - inicio)} ms`);
      return listo;
    })().finally(() => {
      instalando = null; // si fallo, el proximo intento (ej. con un clic) lo repite
    });
  }
  return instalando;
}

// Mayuscula inicial y punto final en cada frase
function darFormato(texto: string): string {
  const t = texto.trim();
  if (!t) {
    return '';
  }
  const conMayuscula = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(conMayuscula) ? conMayuscula : `${conMayuscula}.`;
}

export class DictadoNavegador {
  private rec: any = null;
  private activo = false;
  private pista: MediaStreamTrack | undefined;
  private frases = 0;
  private provisorio = ''; // ultimo texto en gris todavia sin confirmar
  private alTerminar: (() => void) | null = null;
  // Se cumple cuando el reconocedor termino del todo (ya entrego la ultima frase)
  readonly terminado = new Promise<void>(resolver => (this.alTerminar = resolver));

  constructor(
    private readonly onParcial: (texto: string) => void, // provisorio -> gris
    private readonly onFrase: (texto: string) => void, // confirmado -> cuadro
    private readonly onError: (error: Error) => void,
    private readonly onFin: () => void = () => undefined // termino (Detener, fin del MP3 o error)
  ) {}

  // Sin pista: el microfono. Con pista: audio de un archivo (dictarArchivo)
  start(pista?: MediaStreamTrack): void {
    this.activo = true;
    this.pista = pista;
    this.arrancar();
  }

  private arrancar(): void {
    const rec = new SR();
    rec.lang = IDIOMA;
    rec.processLocally = true; // NUNCA el servidor: si no hay modo local, falla
    rec.continuous = true;
    rec.interimResults = true;

    // Se recorren TODOS los resultados de esta sesion y se cuentan los finales ya
    // entregados: no se depende de resultIndex (Chrome puede informar el indice de
    // la frase nueva en el mismo evento en que confirma la anterior, y esa
    // confirmacion se perderia).
    let entregados = 0;
    rec.onresult = (evento: any) => {
      let parcial = '';
      for (let i = 0; i < evento.results.length; i++) {
        const resultado = evento.results[i];
        if (resultado.isFinal) {
          if (i >= entregados) {
            entregados = i + 1;
            const frase = darFormato(resultado[0].transcript);
            if (frase) {
              this.frases++;
              registro(`dictado del navegador: frase ${this.frases} (${frase.length} caracteres)`);
              this.onFrase(frase);
            }
          }
        } else {
          parcial += resultado[0].transcript;
        }
      }
      this.provisorio = parcial.trim();
      if (this.provisorio) {
        this.onParcial(this.provisorio);
      }
    };

    rec.onerror = (evento: any) => {
      // no-speech (silencio largo) y aborted (Cancelar) no son errores para el medico
      if (evento.error === 'no-speech' || evento.error === 'aborted') {
        return;
      }
      advertencia(`dictado del navegador: error ${evento.error}`);
      this.activo = false;
      this.onError(Object.assign(new Error(evento.message || evento.error), { name: evento.error }));
    };

    // Chrome cierra la sesion tras un rato de silencio: con el microfono y
    // mientras se siga grabando, se vuelve a abrir sola
    rec.onend = () => {
      // Si la sesion termino con texto en gris sin confirmar, se confirma igual:
      // que no se pierda lo ultimo dicho
      if (this.provisorio) {
        const frase = darFormato(this.provisorio);
        this.provisorio = '';
        this.frases++;
        registro(`dictado del navegador: frase ${this.frases} confirmada al cerrar (${frase.length} caracteres)`);
        this.onFrase(frase);
      }
      if (this.activo && !this.pista) {
        this.arrancar();
        return;
      }
      this.activo = false;
      this.onFin();
      this.alTerminar?.();
    };

    if (this.pista) {
      rec.start(this.pista);
    } else {
      rec.start();
    }
    this.rec = rec;
  }

  // Detener: deja de escuchar y confirma la ultima frase
  stop(): void {
    this.activo = false;
    this.rec?.stop();
  }

  // Cancelar / cerrar el panel: corta sin esperar
  abort(): void {
    this.activo = false;
    this.rec?.abort();
  }
}

// MP3: se decodifica y se "reproduce" hacia el reconocedor (no se escucha). Tarda
// lo mismo que dura el audio; mientras tanto el texto va apareciendo en gris.
export async function dictarArchivo(archivo: Blob, dictado: DictadoNavegador, vigente: () => boolean): Promise<void> {
  const contexto = new AudioContext();
  try {
    const audio = await contexto.decodeAudioData(await archivo.arrayBuffer());
    registro(`dictado del navegador: archivo de ${audio.duration.toFixed(1)} s`);
    const fuente = contexto.createBufferSource();
    fuente.buffer = audio;
    const destino = contexto.createMediaStreamDestination();
    fuente.connect(destino);
    const terminado = new Promise<void>(resolver => (fuente.onended = () => resolver()));
    dictado.start(destino.stream.getAudioTracks()[0]);
    fuente.start();
    await terminado;
    if (vigente()) {
      await new Promise(resolver => setTimeout(resolver, 1500)); // silencio final: cierra la ultima frase
      dictado.stop();
      // El audio se cierra recien cuando el reconocedor termino de entregar todo
      // (si se cierra antes, la ultima frase confirmada se pierde). Maximo 10 s.
      await Promise.race([dictado.terminado, new Promise(resolver => setTimeout(resolver, 10000))]);
    }
  } finally {
    await contexto.close().catch(() => undefined);
  }
}
