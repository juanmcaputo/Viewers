// Decodifica un MP3 del equipo (File) o una grabacion del microfono (Blob) en el
// navegador y la convierte a mono, PCM Float32, 16.000 muestras por segundo: el
// formato que esperan Silero VAD y Whisper. Nada se sube a ningun servidor.
//
// MediaRecorder no garantiza MP3 (suele dar WebM/Opus u OGG): no importa, porque
// las dos entradas pasan por aca. El navegador tiene que soportar el codec real.

import { registro, fallo } from './registroVoz';

export async function decodificarAudio(blob: Blob): Promise<Float32Array> {
  if (!blob.size) {
    throw new Error('El archivo o grabación está vacío');
  }

  const inicio = performance.now();
  const contexto = new AudioContext();
  try {
    const buffer = await contexto.decodeAudioData(await blob.arrayBuffer());
    const frecuenciaDestino = 16000;
    const cantidad = Math.ceil(buffer.duration * frecuenciaDestino);

    // Un unico canal y remuestreo a 16 kHz
    const offline = new OfflineAudioContext(1, cantidad, frecuenciaDestino);
    const fuente = offline.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(offline.destination);
    fuente.start(0);

    const resultado = await offline.startRendering();
    registro(
      `audio decodificado: ${(blob.size / 1048576).toFixed(2)} MB ${blob.type || '(tipo desconocido)'},`,
      `${buffer.duration.toFixed(1)} s, ${buffer.numberOfChannels} canal(es) a ${buffer.sampleRate} Hz -> mono 16 kHz,`,
      `${Math.round(performance.now() - inicio)} ms`
    );
    // Copia propia: no depender del ciclo de vida del AudioBuffer
    return new Float32Array(resultado.getChannelData(0));
  } catch (error) {
    fallo(`no se pudo decodificar el audio (${blob.type || 'tipo desconocido'}, ${blob.size} bytes)`, error);
    throw new Error('No se pudo decodificar el audio. Verifique su formato.');
  } finally {
    await contexto.close();
  }
}
