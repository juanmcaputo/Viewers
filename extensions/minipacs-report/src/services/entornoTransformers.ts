// Configuracion "solo local" de Transformers.js, en un unico lugar.
// La importan DetectorVoz.ts (Silero VAD) y SpeechTranscriber.ts (Whisper)
// antes de crear cualquier modelo: un modulo ES se evalua una sola vez aunque
// se importe desde varios lados, asi las dos configuraciones no pueden quedar
// distintas.
//
// Los archivos de los modelos y los .wasm se sirven desde el MISMO servidor de
// OHIF: los copia webpack desde extensions/minipacs-report/public/minipacs/
// (-> /minipacs/models/... y /minipacs/ort/...). Nunca Hugging Face Hub ni CDN:
// el audio y el texto no salen del navegador.
//
// Todo bajo /minipacs/: OHIF ya usa /ort/ para SU ONNX Runtime 1.17.1 (el de
// @cornerstonejs/ai, copiado por platform/app/.webpack/webpack.pwa.js). El nuestro
// es otra version (1.22 de Transformers.js) y no tiene que mezclarse con ese.
// Para que webpack le entregue a Transformers SU 1.22 (y no el 1.17.1 de la raiz)
// hay una regla en .webpack/webpack.base.js (buscar "MiniPACS").

import { env } from '@huggingface/transformers';
import { registro, advertencia, fallo } from './registroVoz';

const PREFIJO_PROPIO = '/minipacs/';

// Sirve en la pagina y en el Web Worker de Whisper (whisper.worker.ts): en el
// worker no existe window, por eso se usa globalThis
const global: any = globalThis;

// Solo modelos locales
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${PREFIJO_PROPIO}models/`;

// Por defecto ONNX Runtime Web puede bajar sus .wasm de un CDN: se sirven desde OHIF
env.backends.onnx.wasm.wasmPaths = `${PREFIJO_PROPIO}ort/`;

// ---------------------------------------------------------------------------
// Archivos que faltan: el servidor de OHIF (webpack-dev-server y nginx) responde
// cualquier ruta inexistente con SU pagina (index.html) y codigo 200. Para
// Transformers.js eso es "el archivo existe": intenta leer HTML como modelo
// ("protobuf parsing failed") o como JSON. Esta guardia convierte esa respuesta
// en un 404 real, SOLO para nuestras rutas /minipacs/: asi la libreria informa
// la ruta exacta que falta y saltea bien los archivos opcionales. El resto de los
// pedidos de OHIF pasa sin tocarse.
// ---------------------------------------------------------------------------
const esHtml = (respuesta: Response) =>
  (respuesta.headers.get('content-type') || '').toLowerCase().includes('text/html');

function rutaDe(entrada: RequestInfo | URL): string {
  const texto = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  try {
    return new URL(texto, global.location.href).pathname;
  } catch {
    return texto;
  }
}

const marca = '__minipacsGuardiaFetch'; // se instala una sola vez (recarga en caliente)
if (typeof global.fetch === 'function' && !global[marca]) {
  const fetchOriginal = global.fetch.bind(global);
  global[marca] = true;
  global.fetch = async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    const ruta = rutaDe(entrada);
    if (!ruta.startsWith(PREFIJO_PROPIO)) {
      return fetchOriginal(entrada, opciones); // pedidos de OHIF: sin cambios
    }
    const inicio = performance.now();
    let respuesta: Response;
    try {
      respuesta = await fetchOriginal(entrada, opciones);
    } catch (error) {
      fallo(`no se pudo pedir ${ruta} (error de red o servidor caido)`, error);
      throw error;
    }
    const ms = Math.round(performance.now() - inicio);
    const tamano = respuesta.headers.get('content-length');
    if (respuesta.ok && esHtml(respuesta)) {
      advertencia(`FALTA el archivo ${ruta} (el servidor devolvio la pagina de OHIF): se informa 404`);
      return new Response(null, { status: 404, statusText: 'Not Found (MiniPACS)' });
    }
    registro(
      `archivo ${ruta} -> ${respuesta.status}`,
      `${respuesta.headers.get('content-type') || '?'}`,
      tamano ? `${(Number(tamano) / 1048576).toFixed(1)} MB` : '',
      `${ms} ms`
    );
    return respuesta;
  };
}

// ---------------------------------------------------------------------------
// Cache de los modelos en el navegador (para no volver a bajarlos cada vez).
// No se usa la de la libreria ("transformers-cache"): guarda cualquier respuesta
// con codigo 200, incluida la pagina HTML de OHIF cuando un archivo todavia no
// existia, y despues la sigue usando aunque el archivo real ya este (F5 no la
// borra). Esta cache propia NUNCA guarda HTML ni errores, y la vieja se borra.
// Cambiar la version del nombre invalida todo lo guardado (ej. al cambiar modelos).
// ---------------------------------------------------------------------------
const NOMBRE_CACHE = 'minipacs-modelos-v1';
const CACHE_VIEJA = 'transformers-cache';

if (typeof caches !== 'undefined') {
  caches
    .delete(CACHE_VIEJA)
    .then(existia => existia && registro(`cache vieja "${CACHE_VIEJA}" borrada`))
    .catch(() => undefined);

  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = {
    async match(clave: string) {
      const cache = await caches.open(NOMBRE_CACHE);
      const guardado = await cache.match(clave);
      if (guardado && esHtml(guardado)) {
        await cache.delete(clave); // por las dudas: nunca devolver HTML como modelo
        return undefined;
      }
      if (guardado) {
        registro(`archivo ${clave} -> desde la cache del navegador`);
      }
      return guardado;
    },
    async put(clave: string, respuesta: Response) {
      if (!respuesta.ok || esHtml(respuesta)) {
        advertencia(`no se guarda en cache ${clave} (respuesta ${respuesta.status}, no es un modelo)`);
        return;
      }
      const cache = await caches.open(NOMBRE_CACHE);
      await cache.put(clave, respuesta);
    },
  };
} else {
  env.useBrowserCache = false; // sin Cache API (contexto no seguro): sin cache
}

registro(`entorno listo (${typeof window === 'undefined' ? 'hilo de Whisper' : 'pagina'})`, {
  modelos: env.localModelPath,
  motor: env.backends.onnx.wasm.wasmPaths,
  cache: typeof caches !== 'undefined' ? NOMBRE_CACHE : 'sin cache',
  aisladoCrossOrigin: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
  nucleos: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : '?',
  webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
});
