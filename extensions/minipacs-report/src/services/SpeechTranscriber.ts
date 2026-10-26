// Whisper en el navegador: recibe PCM mono a 16 kHz y devuelve texto.
// No es un cliente HTTP ni una API remota: el modelo corre en la PC del medico.
//
// Whisper corre en un hilo aparte (whisper.worker.ts) para no trabar OHIF. Este
// archivo es el lado de la pagina: elige el modelo segun la placa de video
// (ElegirModelo.ts), le pide al hilo que lo cargue y precaliente, y le manda los
// tramos de audio. Recibe tramos ya recortados por la deteccion de voz (25 s como
// maximo), que entran en la ventana de 30 s de Whisper.

import { registro, advertencia } from './registroVoz';
import { elegirPerfil, bajarPerfil, perfilAnterior, PerfilWhisper } from './ElegirModelo';

// Estado del dictado para el panel ("Preparando el dictado... 45 %", "listo")
export interface EstadoDictado {
  fase: 'inactivo' | 'cargando' | 'precalentando' | 'listo' | 'error';
  porcentaje: number;
  perfil: PerfilWhisper | null;
  error?: Error;
  // Precalentando hace mas de AVISO_DEMORA_MS: el panel deja dictar igual (la
  // primera frase espera lo que falte) en lugar de quedar en "Preparando..."
  demorado?: boolean;
}
let estado: EstadoDictado = { fase: 'inactivo', porcentaje: 0, perfil: null };
const oyentes = new Set<(estado: EstadoDictado) => void>();

function cambiarEstado(cambios: Partial<EstadoDictado>) {
  estado = { ...estado, ...cambios };
  oyentes.forEach(oyente => oyente(estado));
}

// El panel se suscribe al abrirse (recibe el estado actual enseguida) y se
// desuscribe al cerrarse con la funcion que devuelve
export function suscribirEstado(oyente: (estado: EstadoDictado) => void): () => void {
  oyentes.add(oyente);
  oyente(estado);
  return () => oyentes.delete(oyente);
}

// Vigilante: la primera carga en una placa de video integrada puede tardar minutos
// (compilar los programas de la placa) o colgarse. No se deja el panel trabado:
// - precalentando mas de AVISO_DEMORA_MS: se habilita el dictado igual (demorado)
// - el hilo no da senales en SIN_SENAL_MS: se lo reemplaza por uno mas liviano
const AVISO_DEMORA_MS = 20_000;
const SIN_SENAL_MS = 150_000;
const MAX_REEMPLAZOS = 3;
let vigilante: ReturnType<typeof setInterval> | null = null;
let ultimaSenal = 0;
let desdePrecalentamiento = 0;
let reemplazos = 0;
let rechazarCarga: ((error: Error) => void) | null = null;

function detenerVigilante() {
  if (vigilante) {
    clearInterval(vigilante);
    vigilante = null;
  }
}

function vigilar() {
  detenerVigilante();
  ultimaSenal = performance.now();
  vigilante = setInterval(() => {
    const ahora = performance.now();
    if (estado.fase === 'precalentando' && !estado.demorado && ahora - desdePrecalentamiento > AVISO_DEMORA_MS) {
      registro(`Whisper sigue precalentando tras ${AVISO_DEMORA_MS / 1000} s: se habilita el dictado igual`);
      cambiarEstado({ demorado: true });
    }
    if (ahora - ultimaSenal > SIN_SENAL_MS) {
      reemplazarHilo();
    }
  }, 5000);
}

// El hilo no responde: se lo corta y se arranca otro con el modelo anterior
// (mas liviano). Los que esperaban el modelo reciben un error claro.
function reemplazarHilo() {
  detenerVigilante();
  const perfil = estado.perfil;
  const error = new Error(`El dictado no respondió en ${SIN_SENAL_MS / 1000} s`);
  advertencia(`Whisper no dio senales en ${SIN_SENAL_MS / 1000} s (${perfil?.id}): se reemplaza por uno mas liviano`);
  hilo?.terminate();
  hilo = null;
  listo = null;
  pendientes.forEach(p => p.rechazar(error));
  pendientes.clear();
  rechazarCarga?.(error);
  if (perfil && perfilAnterior(perfil.id).id !== perfil.id && reemplazos < MAX_REEMPLAZOS) {
    reemplazos++;
    bajarPerfil(perfil.id, 'el hilo no respondio');
    precargarModelo(); // elegirPerfil() ya lee el perfil mas liviano
    return;
  }
  cambiarEstado({ fase: 'error', error });
}

let hilo: Worker | null = null;
let listo: Promise<void> | null = null;
let siguienteId = 0;
const pendientes = new Map<
  number,
  { resolver: (texto: string) => void; rechazar: (error: Error) => void; onParcial?: (texto: string) => void }
>();

const comoError = (datos: any) => Object.assign(new Error(datos.mensaje), { name: datos.nombre });

function iniciar(): Promise<void> {
  if (listo) {
    return listo;
  }
  cambiarEstado({ fase: 'cargando', porcentaje: 0, error: undefined, demorado: false });
  vigilar();
  listo = new Promise<void>((resolver, rechazar) => {
    rechazarCarga = rechazar;
    hilo = new Worker(new URL('./whisper.worker.ts', import.meta.url));
    hilo.onmessage = (evento: MessageEvent) => {
      const datos = evento.data;
      ultimaSenal = performance.now();
      if (datos.tipo === 'progreso') {
        if (datos.fase === 'precalentando' && estado.fase !== 'precalentando') {
          desdePrecalentamiento = performance.now();
        }
        cambiarEstado({ fase: datos.fase, porcentaje: datos.porcentaje, perfil: datos.perfil });
      } else if (datos.tipo === 'listo') {
        detenerVigilante();
        if (datos.perfil.id !== datos.pedido.id) {
          // El que eligio la prueba de la placa no cargo: se recuerda en esta PC
          bajarPerfil(datos.pedido.id, `no cargo ${datos.pedido.id} en esta placa`);
        }
        cambiarEstado({ fase: 'listo', porcentaje: 100, perfil: datos.perfil, demorado: false });
        resolver();
      } else if (datos.tipo === 'parcial') {
        pendientes.get(datos.id)?.onParcial?.(datos.texto);
      } else if (datos.tipo === 'texto') {
        pendientes.get(datos.id)?.resolver(datos.texto);
        pendientes.delete(datos.id);
      } else if (datos.tipo === 'error') {
        if (datos.id === undefined) {
          listo = null; // fallo la carga: el proximo intento la repite
          detenerVigilante();
          cambiarEstado({ fase: 'error', error: comoError(datos) });
          rechazar(comoError(datos));
        } else {
          pendientes.get(datos.id)?.rechazar(comoError(datos));
          pendientes.delete(datos.id);
        }
      }
    };
    hilo.onerror = evento => {
      advertencia('el hilo de Whisper fallo', evento.message);
      detenerVigilante();
      listo = null;
      hilo?.terminate();
      hilo = null;
      const error = new Error(evento.message || 'No se pudo iniciar el hilo de Whisper');
      cambiarEstado({ fase: 'error', error });
      rechazar(error);
    };
    elegirPerfil().then(
      perfil => {
        registro(`Whisper se carga en un hilo aparte: ${perfil.id}`);
        cambiarEstado({ perfil });
        hilo?.postMessage({ tipo: 'cargar', perfil });
      },
      error => {
        detenerVigilante();
        listo = null;
        cambiarEstado({ fase: 'error', error });
        rechazar(error);
      }
    );
  });
  return listo;
}

// Al abrir el panel de informe (o al dictar): cargar y precalentar Whisper en su
// hilo. NO se llama al iniciar OHIF: la carga (descarga de los modelos, compilar los
// programas de la placa de video) compite con las imagenes del visor. Si ya esta
// cargando o listo, no hace nada.
export function precargarModelo(): void {
  iniciar().catch(() => undefined); // el error se muestra al transcribir
}

// onParcial (opcional) recibe el texto a medida que Whisper lo va generando
export async function transcribirAudio(
  pcm16k: Float32Array,
  onParcial?: (texto: string) => void
): Promise<string> {
  if (!(pcm16k instanceof Float32Array) || pcm16k.length === 0) {
    throw new Error('Audio vacío o no decodificado');
  }
  await iniciar();
  const id = ++siguienteId;
  const texto = await new Promise<string>((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar, onParcial });
    hilo!.postMessage({ tipo: 'transcribir', id, audio: pcm16k });
  });
  return texto;
}
