// Deteccion de voz (VAD) con Silero, usando la MISMA biblioteca Transformers.js.
// Recibe PCM mono a 16 kHz y devuelve los tramos que tienen voz, sin los
// silencios: Whisper inventa frases en los silencios ("Gracias por ver el
// video"), y ademas se evita procesar audio inutil. Sirve igual para el
// microfono y para un MP3.
//
// Dos pasos, separados a proposito:
//   1. probabilidadesDeVoz(): el modelo da, por cada ventana de 32 ms, la
//      probabilidad de que haya voz (0 a 1).
//   2. segmentar(): con esas probabilidades decide donde empieza y termina cada
//      tramo. Es una funcion pura: se prueba sin modelo, con numeros inventados.
//
// Carga del modelo, tensores sr/state y nombres de entradas/salidas: igual que el
// ejemplo oficial de Transformers.js (transformers.js-examples/moonshine-web),
// que le pasa a Silero ventanas de 512 muestras sin contexto adicional.

import { AutoModel, Tensor } from '@huggingface/transformers';
import './entornoTransformers';
import { registro, medir } from './registroVoz';

const MODELO_VAD = 'onnx-community/silero-vad';
const FRECUENCIA = 16000;
export const MUESTRAS_POR_VENTANA = 512; // 32 ms a 16 kHz (Silero v5)
export const MS_POR_VENTANA = (MUESTRAS_POR_VENTANA / FRECUENCIA) * 1000;

export interface OpcionesVad {
  umbralInicio: number; // probabilidad a partir de la cual empieza la voz
  umbralFin: number; // por debajo cuenta como silencio (histeresis)
  vozMinimaMs: number; // descarta golpes, clics y toses cortas
  silencioParaCortarMs: number; // pausa que cierra un tramo
  colchonMs: number; // se agrega antes y despues para no cortar silabas
  segmentoMaximoS: number; // Whisper trabaja en ventanas de 30 s
}

// Valores para dictado (los por defecto de Silero: 0.5 / 0.35). El ejemplo
// oficial, pensado para conversacion en vivo, usa 0.3 / 0.1, pausa de 400 ms y
// colchon de 80 ms: probarlos si en las pruebas se pierde voz baja.
export const OPCIONES_VAD: OpcionesVad = {
  umbralInicio: 0.5,
  umbralFin: 0.35,
  vozMinimaMs: 250,
  silencioParaCortarMs: 700, // MP3; en vivo 300 (DetectorVozEnVivo.ts)
  colchonMs: 300,
  segmentoMaximoS: 25,
};

export interface SegmentoVoz {
  inicio: number; // segundos
  fin: number; // segundos
  audio: Float32Array; // PCM 16 kHz del tramo, con colchon
}

let modeloPromise: Promise<any> | null = null;

// El modelo se carga una sola vez por sesion, recien cuando se usa
// Exportado tambien para el modo en vivo (DetectorVozEnVivo.ts)
export function obtenerModelo() {
  if (!modeloPromise) {
    modeloPromise = medir(`carga del modelo ${MODELO_VAD}`, () =>
      AutoModel.from_pretrained(MODELO_VAD, {
        config: { model_type: 'custom' } as any, // Silero no es un modelo "transformers"
        dtype: 'fp32',
        device: 'wasm',
      })
    ).catch(error => {
      modeloPromise = null; // permitir reintento
      throw error;
    });
  }
  return modeloPromise;
}

// Paso 1: probabilidad de voz de cada ventana de 32 ms (usa el modelo).
// Estado nuevo por cada audio: no se comparte entre grabaciones o archivos.
export async function probabilidadesDeVoz(pcm16k: Float32Array): Promise<Float32Array> {
  const modelo = await obtenerModelo();
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(FRECUENCIA)]), []);
  let estado = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);

  const cantidad = Math.floor(pcm16k.length / MUESTRAS_POR_VENTANA);
  const probabilidades = new Float32Array(cantidad);
  for (let i = 0; i < cantidad; i++) {
    const ventana = pcm16k.slice(i * MUESTRAS_POR_VENTANA, (i + 1) * MUESTRAS_POR_VENTANA);
    const input = new Tensor('float32', ventana, [1, MUESTRAS_POR_VENTANA]);
    const { output, stateN } = await modelo({ input, sr, state: estado });
    estado = stateN; // el estado pasa a la ventana siguiente
    probabilidades[i] = output.data[0];
  }
  return probabilidades;
}

// Paso 2: tramos con voz, en muestras [inicio, fin). Funcion pura.
export function segmentar(
  probabilidades: Float32Array,
  totalMuestras: number,
  o: OpcionesVad = OPCIONES_VAD
): Array<[number, number]> {
  const ventanas = (ms: number) => Math.max(1, Math.round(ms / MS_POR_VENTANA));
  // El corte forzado descuenta los dos colchones: con ellos el tramo no supera el maximo
  const vozMaximaMs = o.segmentoMaximoS * 1000 - 2 * o.colchonMs;
  const rangos: Array<[number, number]> = [];
  let enVoz = false;
  let inicio = 0;
  let silencio = 0;

  for (let i = 0; i < probabilidades.length; i++) {
    const p = probabilidades[i];
    if (!enVoz) {
      if (p >= o.umbralInicio) {
        enVoz = true;
        inicio = i;
        silencio = 0;
      }
      continue;
    }
    silencio = p < o.umbralFin ? silencio + 1 : 0;
    const largo = i - inicio + 1;
    const pausaLarga = silencio >= ventanas(o.silencioParaCortarMs);
    const demasiadoLargo = largo >= ventanas(vozMaximaMs);
    if (pausaLarga || demasiadoLargo) {
      const fin = i - silencio + 1; // termina donde empezo el silencio
      if (fin - inicio >= ventanas(o.vozMinimaMs)) {
        rangos.push([inicio, fin]);
      }
      enVoz = false;
    }
  }
  if (enVoz && probabilidades.length - inicio >= ventanas(o.vozMinimaMs)) {
    rangos.push([inicio, probabilidades.length]);
  }

  // Ventanas -> muestras, con colchon antes y despues
  const colchon = Math.round((o.colchonMs / 1000) * FRECUENCIA);
  const maximo = o.segmentoMaximoS * FRECUENCIA;
  const resultado: Array<[number, number]> = [];
  for (const [a, b] of rangos) {
    let desde = Math.max(0, a * MUESTRAS_POR_VENTANA - colchon);
    let hasta = Math.min(totalMuestras, b * MUESTRAS_POR_VENTANA + colchon);
    const anterior = resultado[resultado.length - 1];
    if (anterior && desde <= anterior[1]) {
      if (hasta - anterior[0] <= maximo) {
        anterior[1] = hasta; // se solapan por el colchon: se unen
        continue;
      }
      desde = anterior[1]; // unidos serian demasiado largos: sin repetir audio
    }
    hasta = Math.min(hasta, desde + maximo); // por redondeo de ventanas, nunca mas del maximo
    resultado.push([desde, hasta]);
  }
  return resultado;
}

// Lo que usa el panel: audio -> tramos con voz (sin silencios)
export async function detectarSegmentosDeVoz(
  pcm16k: Float32Array,
  o: OpcionesVad = OPCIONES_VAD
): Promise<SegmentoVoz[]> {
  const segundos = (pcm16k.length / FRECUENCIA).toFixed(1);
  const probabilidades = await medir(`deteccion de voz en ${segundos} s de audio`, () =>
    probabilidadesDeVoz(pcm16k)
  );
  const segmentos = segmentar(probabilidades, pcm16k.length, o).map(([a, b]) => ({
    inicio: a / FRECUENCIA,
    fin: b / FRECUENCIA,
    audio: pcm16k.slice(a, b),
  }));
  registro(
    `tramos con voz: ${segmentos.length}`,
    segmentos.map(s => `${s.inicio.toFixed(1)}-${s.fin.toFixed(1)}s`).join(' ') || '(ninguno)'
  );
  return segmentos;
}
