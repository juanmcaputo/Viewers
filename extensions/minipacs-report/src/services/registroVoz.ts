// Registro de diagnostico de la transcripcion local, en la consola del navegador
// (F12 -> Console), con el prefijo [MiniPACS voz] para filtrarlo.
//
// CONFIDENCIALIDAD: aca se registran etapas, tiempos, URLs de los modelos, tamanos
// y errores. NUNCA el audio ni el texto dictado (solo cantidades: segundos de
// audio, cantidad de caracteres).

const PREFIJO = '[MiniPACS voz]';
const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

// Segundos desde que cargo la extension: sirve para ver cuanto tarda cada paso
function reloj(): string {
  const ahora = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return `+${((ahora - t0) / 1000).toFixed(1)}s`;
}

export function registro(...partes: unknown[]): void {
  console.info(PREFIJO, reloj(), ...partes);
}

export function advertencia(...partes: unknown[]): void {
  console.warn(PREFIJO, reloj(), ...partes);
}

export function fallo(...partes: unknown[]): void {
  console.error(PREFIJO, reloj(), ...partes);
}

// Mide una tarea asincronica y registra cuanto tardo (o el error, si fallo)
export async function medir<T>(nombre: string, tarea: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  registro(`${nombre}: empieza`);
  try {
    const resultado = await tarea();
    registro(`${nombre}: listo en ${Math.round(performance.now() - inicio)} ms`);
    return resultado;
  } catch (error) {
    fallo(`${nombre}: fallo despues de ${Math.round(performance.now() - inicio)} ms`, error);
    throw error;
  }
}

// Texto del error tal cual (para mostrar como "Detalle tecnico" en el panel)
export function detalleDeError(error: unknown): string {
  const nombre = (error as { name?: string })?.name;
  const mensaje = error instanceof Error ? error.message : String(error ?? '');
  const texto = nombre && nombre !== 'Error' ? `${nombre}: ${mensaje}` : mensaje;
  return texto.length > 400 ? `${texto.slice(0, 400)}...` : texto;
}
