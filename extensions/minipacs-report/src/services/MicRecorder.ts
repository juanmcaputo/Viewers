// Graba el microfono LOCALMENTE mientras el medico habla, y al detener devuelve
// un Blob y libera el microfono. No hace streaming ni envia nada a un servidor.
// Los silencios de la grabacion los saca despues DetectorVoz.ts.
//
// El permiso del microfono se pide recien al empezar a grabar. Requiere HTTPS o
// localhost (en desarrollo, http://localhost:3000; en el servidor, la URL HTTPS).

import { registro } from './registroVoz';

export class MicRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    if (this.recorder?.state === 'recording') {
      throw new Error('Ya existe una grabación activa');
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('Micrófono no disponible en este navegador/contexto');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    try {
      const opciones = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find(tipo =>
        MediaRecorder.isTypeSupported(tipo)
      );
      this.recorder = new MediaRecorder(this.stream, opciones ? { mimeType: opciones } : undefined);
      this.recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      this.recorder.start();
      registro(`grabacion iniciada (formato ${this.recorder.mimeType || 'por defecto del navegador'})`);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== 'recording') {
      return Promise.reject(new Error('No hay grabación activa'));
    }
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: recorder.mimeType || 'application/octet-stream',
        });
        this.release();
        registro(`grabacion detenida: ${(blob.size / 1024).toFixed(0)} KB, ${blob.type}, microfono liberado`);
        if (blob.size === 0) {
          reject(new Error('Grabación vacía'));
        } else {
          resolve(blob);
        }
      };
      recorder.onerror = () => {
        this.release();
        reject(new Error('Error durante la grabación'));
      };
      recorder.stop();
    });
  }

  // Libera el microfono (la luz de "grabando" del navegador se apaga)
  release(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
