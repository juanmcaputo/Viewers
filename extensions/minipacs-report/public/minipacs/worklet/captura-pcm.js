// Captura del microfono EN VIVO (modo dictado). Corre en el hilo de audio del
// navegador: junta las muestras, las lleva a 16 kHz si el navegador no lo hizo
// y manda bloques de 512 (32 ms, lo que pide Silero) a MicEnVivo.ts.
// OHIF lo sirve en /minipacs/worklet/captura-pcm.js (se carga por URL, por eso
// esta en public/ y no en src/). El audio no sale de la PC.

const DESTINO = 16000;
const BLOQUE = 512;

class CapturaPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bloque = new Float32Array(BLOQUE);
    this.n = 0;
    // sampleRate es global en el AudioWorklet: la frecuencia del AudioContext
    this.paso = sampleRate / DESTINO; // 1 si ya esta a 16 kHz
    this.posicion = 0; // posicion fraccionaria de la proxima muestra de salida
    this.anterior = 0; // ultima muestra del bloque anterior (para interpolar)
  }

  emitir(muestra) {
    this.bloque[this.n++] = muestra;
    if (this.n === BLOQUE) {
      this.port.postMessage(this.bloque.slice());
      this.n = 0;
    }
  }

  process(entradas) {
    const canal = entradas[0] && entradas[0][0]; // mono: primer canal
    if (!canal) {
      return true;
    }
    if (this.paso === 1) {
      for (let i = 0; i < canal.length; i++) {
        this.emitir(canal[i]);
      }
      return true;
    }
    // Remuestreo: promedio de las muestras de cada intervalo (filtra agudos que
    // no entran en 16 kHz) e interpolacion lineal para la posicion fraccionaria
    while (this.posicion < canal.length) {
      const desde = Math.floor(this.posicion);
      const hasta = Math.min(canal.length, Math.floor(this.posicion + this.paso));
      let suma = 0;
      let cuenta = 0;
      for (let i = desde; i < hasta; i++) {
        suma += canal[i];
        cuenta++;
      }
      if (cuenta === 0) {
        const fraccion = this.posicion - desde;
        const a = desde === 0 ? this.anterior : canal[desde - 1];
        suma = a + (canal[desde] - a) * fraccion;
        cuenta = 1;
      }
      this.emitir(suma / cuenta);
      this.posicion += this.paso;
    }
    this.posicion -= canal.length;
    this.anterior = canal[canal.length - 1];
    return true; // seguir activo
  }
}

registerProcessor('captura-pcm', CapturaPCM);
