// Microfono EN VIVO para el dictado: mientras el medico habla entrega bloques de
// 512 muestras a 16 kHz (32 ms) a quien los pida (DetectorVozEnVivo). No graba
// un archivo ni envia nada a un servidor.
//
// La captura la hace un AudioWorklet servido por OHIF en
// /minipacs/worklet/captura-pcm.js (extensions/minipacs-report/public/...).
// Requiere HTTPS o localhost, igual que MicRecorder.

import { registro } from './registroVoz';

const WORKLET = '/minipacs/worklet/captura-pcm.js';

export class MicEnVivo {
  private contexto: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodo: AudioWorkletNode | null = null;

  async start(onBloque: (bloque: Float32Array) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      throw new Error('Micrófono no disponible en este navegador/contexto');
    }
    const t0 = performance.now();
    const ms = () => `${Math.round(performance.now() - t0)} ms`;
    registro('microfono en vivo: pidiendo el microfono');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    registro(`microfono en vivo: microfono abierto (${ms()})`);
    try {
      // Pedir 16 kHz directamente; si el navegador no puede conectar el microfono
      // a esa frecuencia, se usa la normal y el worklet remuestrea
      let fuente: MediaStreamAudioSourceNode;
      try {
        this.contexto = new AudioContext({ sampleRate: 16000 });
        fuente = this.contexto.createMediaStreamSource(this.stream);
      } catch {
        await this.contexto?.close();
        this.contexto = new AudioContext();
        fuente = this.contexto.createMediaStreamSource(this.stream);
      }
      registro(`microfono en vivo: contexto de audio creado, estado ${this.contexto.state} (${ms()})`);
      await this.contexto.audioWorklet.addModule(WORKLET);
      registro(`microfono en vivo: captura cargada (${ms()})`);
      this.nodo = new AudioWorkletNode(this.contexto, 'captura-pcm');
      this.nodo.port.onmessage = evento => onBloque(evento.data as Float32Array);
      fuente.connect(this.nodo); // no se conecta a los parlantes
      registro(`microfono en vivo: ${this.contexto.sampleRate} Hz -> 16 kHz, escuchando (${ms()})`);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  // Libera el microfono (se apaga el indicador de "grabando" del navegador)
  release(): void {
    if (this.nodo) {
      this.nodo.port.onmessage = null;
      this.nodo.disconnect();
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.contexto?.close().catch(() => undefined);
    this.nodo = null;
    this.stream = null;
    this.contexto = null;
  }
}
