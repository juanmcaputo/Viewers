// Deteccion de voz EN VIVO: recibe bloques de 32 ms del microfono, les pasa
// Silero de a uno (guardando su estado) y cada vez que el medico hace una pausa
// entrega la frase dicha (PCM 16 kHz) para transcribirla.
//
// Mismas reglas que segmentar() en DetectorVoz.ts, con la pausa mas corta:
// empieza con probabilidad >= umbralInicio, cuenta silencio por debajo de
// umbralFin, corta con silencioParaCortarMs de pausa o al llegar al maximo, y
// descarta lo que dure menos que vozMinimaMs. Colchon: colchonMs de audio antes
// del comienzo; al final ya queda la pausa misma.

import { Tensor } from '@huggingface/transformers';
import { obtenerModelo, OPCIONES_VAD, OpcionesVad, MUESTRAS_POR_VENTANA, MS_POR_VENTANA } from './DetectorVoz';
import { registro } from './registroVoz';

// En vivo la frase se cierra con 300 ms de pausa (en el MP3, 700 ms): el texto
// aparece antes. Si corta frases a la mitad, subir este valor.
export const OPCIONES_EN_VIVO: OpcionesVad = { ...OPCIONES_VAD, silencioParaCortarMs: 300 };

export class DetectorVozEnVivo {
  private estado = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  private readonly sr = new Tensor('int64', BigInt64Array.from([16000n]), []);
  private hablando = false;
  private silencio = 0; // ventanas seguidas sin voz
  private frase: Float32Array[] = [];
  private previas: Float32Array[] = []; // colchon antes de que empiece la voz
  private cola: Promise<void> = Promise.resolve(); // las ventanas en orden
  private detenido = false;

  constructor(
    private readonly onFrase: (audio: Float32Array) => void,
    private readonly onError: (error: unknown) => void,
    private readonly o: OpcionesVad = OPCIONES_EN_VIVO
  ) {}

  agregar(bloque: Float32Array): void {
    if (this.detenido || bloque.length !== MUESTRAS_POR_VENTANA) {
      return;
    }
    this.cola = this.cola
      .then(() => this.procesar(bloque))
      .catch(error => {
        this.detenido = true; // sin modelo no tiene sentido seguir
        this.onError(error);
      });
  }

  private async procesar(bloque: Float32Array): Promise<void> {
    if (this.detenido) {
      return;
    }
    const silero = await obtenerModelo();
    const { output, stateN } = await silero({
      input: new Tensor('float32', bloque, [1, MUESTRAS_POR_VENTANA]),
      sr: this.sr,
      state: this.estado,
    });
    this.estado = stateN;
    const p = output.data[0] as number;

    if (!this.hablando) {
      this.previas.push(bloque);
      if (this.previas.length > Math.round(this.o.colchonMs / MS_POR_VENTANA)) {
        this.previas.shift();
      }
      if (p >= this.o.umbralInicio) {
        this.hablando = true;
        this.frase = [...this.previas]; // incluye el bloque actual
        this.previas = [];
        this.silencio = 0;
      }
      return;
    }

    this.frase.push(bloque);
    this.silencio = p < this.o.umbralFin ? this.silencio + 1 : 0;
    const pausaLarga = this.silencio * MS_POR_VENTANA >= this.o.silencioParaCortarMs;
    const demasiadoLarga = this.frase.length * MS_POR_VENTANA >= this.o.segmentoMaximoS * 1000;
    if (pausaLarga || demasiadoLarga) {
      this.entregar();
    }
  }

  private entregar(): void {
    const vozMs = (this.frase.length - this.silencio) * MS_POR_VENTANA;
    if (this.hablando && vozMs >= this.o.vozMinimaMs) {
      const audio = new Float32Array(this.frase.length * MUESTRAS_POR_VENTANA);
      this.frase.forEach((bloque, i) => audio.set(bloque, i * MUESTRAS_POR_VENTANA));
      registro(`frase en vivo: ${(audio.length / 16000).toFixed(1)} s`);
      this.onFrase(audio);
    }
    this.hablando = false;
    this.frase = [];
    this.silencio = 0;
  }

  // Detener: procesa lo que quedo en cola y entrega la ultima frase
  async cerrar(): Promise<void> {
    await this.cola;
    if (!this.detenido) {
      this.entregar();
    }
    this.detenido = true;
  }

  // Cancelar: descarta todo lo pendiente
  descartar(): void {
    this.detenido = true;
    this.frase = [];
    this.previas = [];
  }
}
