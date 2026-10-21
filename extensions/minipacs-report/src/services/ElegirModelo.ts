// Elige el modelo de Whisper segun lo que puede la PC del medico.
//
// 1. Sin placa de video (WebGPU): whisper-tiny en el procesador (wasm, q8).
// 2. Con placa: una prueba de velocidad de 1-2 s (multiplicacion de matrices en la
//    GPU, la misma cuenta que hace Whisper) da un puntaje en GFLOPS. Con ese puntaje
//    y si la placa soporta fp16 (shader-f16) se elige tiny, base, small o turbo.
// 3. La eleccion se guarda en esta PC (localStorage): la prueba no se repite.
// 4. Si el modelo elegido no llega a cargar en esta placa, se usa el anterior y
//    se recuerda (bajarPerfil). La lentitud de una frase NO cambia la eleccion:
//    se decide solo por la placa.
//
// Los cortes (GFLOPS_SMALL, GFLOPS_TURBO) son PROVISORIOS hasta medir en varias PCs.
// Para probar un modelo a mano, en la consola del navegador:
//   localStorage.setItem('minipacs.voz.forzar', 'small-gpu'); y recargar
//   localStorage.removeItem('minipacs.voz.forzar'); para volver a lo automatico

import { registro, advertencia } from './registroVoz';

export interface PerfilWhisper {
  id: string;
  modelo: string;
  device: 'wasm' | 'webgpu';
  dtype: any;
  necesitaF16: boolean;
}

// De menor a mayor. Los archivos de cada uno los baja instalar-modelos.js.
export const PERFILES: PerfilWhisper[] = [
  { id: 'tiny-cpu', modelo: 'onnx-community/whisper-tiny', device: 'wasm', dtype: 'q8', necesitaF16: false },
  {
    id: 'tiny-gpu',
    modelo: 'onnx-community/whisper-tiny',
    device: 'webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    necesitaF16: false,
  },
  {
    id: 'base-gpu', // placas integradas (ej. Intel Iris Xe: ~100 GFLOPS)
    modelo: 'onnx-community/whisper-base',
    device: 'webgpu',
    // encoder fp32: en fp16 una Iris Xe devolvio basura (">> >> >>"); es lo que usa
    // el ejemplo oficial de Transformers.js para Whisper en WebGPU
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    necesitaF16: false,
  },
  {
    // base AJUSTADO AL CASTELLANO (deepdml/whisper-base-es-mix-norm, Apache-2.0,
    // WER 12,4 % en Common Voice 17), convertido por nosotros a ONNX. Solo para
    // forzarlo a mano: con nuestro dictado de prueba salio PEOR que el original
    // (entrenado con texto normalizado: sin puntos ni mayusculas).
    id: 'base-es-gpu',
    modelo: 'minipacs/whisper-base-es',
    device: 'webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    necesitaF16: false,
  },
  {
    // base ajustado al castellano por HiTZ (HiTZ/whisper-base-es, Apache-2.0, WER
    // 13,5 % en Common Voice 13), convertido por nosotros. Solo para forzarlo a mano.
    id: 'base-hitz-gpu',
    modelo: 'minipacs/whisper-base-es-hitz',
    device: 'webgpu',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    necesitaF16: false,
  },
  {
    id: 'small-gpu',
    modelo: 'onnx-community/whisper-small',
    device: 'webgpu',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    necesitaF16: true,
  },
  {
    id: 'turbo-gpu',
    modelo: 'onnx-community/whisper-large-v3-turbo',
    device: 'webgpu',
    dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
    necesitaF16: true,
  },
];

// Medido: Intel Iris Xe (gen-12lp) = 103 GFLOPS, small ahi es demasiado lento
const GFLOPS_BASE = 80; // provisorio
const GFLOPS_SMALL = 300; // provisorio (placas dedicadas)
const GFLOPS_TURBO = 800; // provisorio

const CLAVE = 'minipacs.voz.eleccion';
const CLAVE_FORZAR = 'minipacs.voz.forzar';
const VERSION = 6; // subirla invalida las elecciones guardadas (ej. al cambiar cortes)

interface Eleccion {
  version: number;
  perfil: string;
  gflops: number | null;
  f16: boolean;
  placa: string;
  fecha: string;
}

const leer = (clave: string) => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};
const escribir = (clave: string, valor: string) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin localStorage: se vuelve a medir la proxima vez */
  }
};

export const perfilPorId = (id: string) => PERFILES.find(p => p.id === id);
export const perfilAnterior = (id: string) => PERFILES[Math.max(0, PERFILES.findIndex(p => p.id === id) - 1)];

// Prueba de velocidad: matrices de 1024x1024 en la GPU. Devuelve GFLOPS.
async function medirGpu(device: any): Promise<number> {
  const N = 1024;
  const codigo = `
    @group(0) @binding(0) var<storage, read> a: array<f32>;
    @group(0) @binding(1) var<storage, read> b: array<f32>;
    @group(0) @binding(2) var<storage, read_write> c: array<f32>;
    var<workgroup> ta: array<array<f32, 16>, 16>;
    var<workgroup> tb: array<array<f32, 16>, 16>;
    @compute @workgroup_size(16, 16)
    fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
      var suma = 0.0;
      for (var t = 0u; t < ${N}u; t = t + 16u) {
        ta[l.y][l.x] = a[g.y * ${N}u + t + l.x];
        tb[l.y][l.x] = b[(t + l.y) * ${N}u + g.x];
        workgroupBarrier();
        for (var k = 0u; k < 16u; k = k + 1u) { suma = suma + ta[l.y][k] * tb[k][l.x]; }
        workgroupBarrier();
      }
      c[g.y * ${N}u + g.x] = suma;
    }`;
  const bytes = N * N * 4;
  const crear = (uso: number) => device.createBuffer({ size: bytes, usage: uso });
  const STORAGE = 0x80; // GPUBufferUsage.STORAGE
  const a = crear(STORAGE);
  const b = crear(STORAGE);
  const c = crear(STORAGE);
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: codigo }), entryPoint: 'main' },
  });
  const grupo = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [a, b, c].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const correr = async (veces: number) => {
    const encoder = device.createCommandEncoder();
    for (let i = 0; i < veces; i++) {
      const paso = encoder.beginComputePass();
      paso.setPipeline(pipeline);
      paso.setBindGroup(0, grupo);
      paso.dispatchWorkgroups(N / 16, N / 16);
      paso.end();
    }
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  };
  try {
    await correr(2); // calentar (compila el shader)
    const veces = 10;
    const inicio = performance.now();
    await correr(veces);
    const segundos = (performance.now() - inicio) / 1000;
    return (2 * N * N * N * veces) / segundos / 1e9;
  } finally {
    [a, b, c].forEach(buffer => buffer.destroy());
  }
}

async function medirYElegir(): Promise<Eleccion> {
  const base = { version: VERSION, fecha: new Date().toISOString() };
  const gpu = (navigator as any).gpu;
  const adaptador = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adaptador) {
    return { ...base, perfil: 'tiny-cpu', gflops: null, f16: false, placa: 'sin WebGPU' };
  }
  const info = adaptador.info || {};
  const placa = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'desconocida';
  const f16 = adaptador.features.has('shader-f16');
  const device = await adaptador.requestDevice();
  try {
    const gflops = Math.round(await medirGpu(device));
    let perfil = 'tiny-gpu';
    if (f16 && gflops >= GFLOPS_TURBO) {
      perfil = 'turbo-gpu';
    } else if (f16 && gflops >= GFLOPS_SMALL) {
      perfil = 'small-gpu';
    } else if (gflops >= GFLOPS_BASE) {
      perfil = 'base-gpu';
    }
    return { ...base, perfil, gflops, f16, placa };
  } finally {
    device.destroy();
  }
}

// Perfil a usar en esta sesion
export async function elegirPerfil(): Promise<PerfilWhisper> {
  const forzado = perfilPorId(leer(CLAVE_FORZAR) || '');
  if (forzado) {
    advertencia(`modelo forzado a mano (${CLAVE_FORZAR}): ${forzado.id}`);
    return forzado;
  }
  let eleccion: Eleccion | null = null;
  try {
    eleccion = JSON.parse(leer(CLAVE) || 'null');
  } catch {
    eleccion = null;
  }
  if (eleccion?.version === VERSION && perfilPorId(eleccion.perfil)) {
    registro(`modelo guardado para esta PC: ${eleccion.perfil}`, eleccion);
    return perfilPorId(eleccion.perfil)!;
  }
  try {
    const inicio = performance.now();
    eleccion = await medirYElegir();
    registro(`prueba de la PC en ${Math.round(performance.now() - inicio)} ms -> ${eleccion.perfil}`, eleccion);
  } catch (error) {
    advertencia('la prueba de la placa de video fallo: se usa el procesador', error);
    eleccion = { version: VERSION, perfil: 'tiny-cpu', gflops: null, f16: false, placa: 'error', fecha: new Date().toISOString() };
  }
  escribir(CLAVE, JSON.stringify(eleccion));
  return perfilPorId(eleccion.perfil)!;
}

// Si el modelo no pudo cargar o es lento, la proxima sesion usa el anterior
export function bajarPerfil(id: string, motivo: string) {
  const anterior = perfilAnterior(id);
  if (anterior.id === id) {
    return;
  }
  advertencia(`${motivo}: la proxima vez se usa ${anterior.id} en lugar de ${id}`);
  let eleccion: any = {};
  try {
    eleccion = JSON.parse(leer(CLAVE) || '{}') || {};
  } catch {
    eleccion = {};
  }
  escribir(CLAVE, JSON.stringify({ ...eleccion, version: VERSION, perfil: anterior.id, bajadoPor: motivo }));
}
