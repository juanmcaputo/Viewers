import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { MicEnVivo } from '../services/MicEnVivo';
import { DetectorVozEnVivo } from '../services/DetectorVozEnVivo';
import { decodificarAudio } from '../services/AudioDecoder';
import { detectarSegmentosDeVoz } from '../services/DetectorVoz';
import { transcribirAudio, precargarModelo, suscribirEstado, EstadoDictado } from '../services/SpeechTranscriber';
import {
  DictadoNavegador,
  dictarArchivo,
  estadoDictadoNavegador,
  prepararDictadoNavegador,
} from '../services/DictadoNavegador';
import { registro, fallo, detalleDeError } from '../services/registroVoz';

// Largo maximo del informe (el contador de abajo a la derecha).
const MAX_CARACTERES = 10000;

// Mensajes claros para los errores tipicos (microfono y modelos)
function mensajeDeError(err: unknown, porDefecto: string): string {
  const nombre = (err as { name?: string })?.name;
  // NotAllowedError / NotFoundError: getUserMedia. not-allowed / audio-capture /
  // language-not-supported: reconocimiento de voz del navegador
  if (nombre === 'NotAllowedError' || nombre === 'not-allowed' || nombre === 'service-not-allowed') {
    return 'El navegador no dio permiso para usar el micrófono';
  }
  if (nombre === 'NotFoundError' || nombre === 'audio-capture') {
    return 'No se encontró un micrófono conectado';
  }
  if (nombre === 'language-not-supported') {
    return 'El castellano del navegador no está instalado en esta PC: se usará el otro motor de dictado. Vuelva a intentar.';
  }
  const texto = err instanceof Error ? err.message : String(err ?? '');
  // Faltan (o estan danados) los archivos de los modelos o de ONNX Runtime en el
  // servidor (/minipacs/models, /minipacs/ort). OHIF responde los archivos que no
  // existen con su propia pagina (HTML, codigo 200), por eso tambien aparecen como
  // "protobuf parsing failed" o JSON invalido. No se descargan de afuera a proposito.
  if (
    /locate file|404|not found|failed to fetch|no available backend|dynamically imported module|protobuf parsing failed|create a session|unexpected token '<'|not valid json/i.test(
      texto
    )
  ) {
    return 'No están instalados en el servidor los modelos de voz (Whisper / Silero) o el motor ONNX, o están dañados. Avisar a sistemas.';
  }
  return texto || porDefecto;
}

export default function ReportPanel({ reportService }) {

  // Texto que escribe el médico
  const [texto, setTexto] = useState('');

  // Mientras se envia: bloquea el panel (evita el doble clic)
  const [enviando, setEnviando] = useState(false);

  // Resultado del ultimo envio
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // Audio (microfono y MP3)
  const [grabando, setGrabando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [estadoAudio, setEstadoAudio] = useState('');
  const [errorAudio, setErrorAudio] = useState<string | null>(null);
  // El error tal cual lo dio el navegador o la libreria (para diagnostico)
  const [detalleAudio, setDetalleAudio] = useState<string | null>(null);
  const inputMp3Ref = useRef<HTMLInputElement>(null);
  // Adjuntar PDF: se guarda como documento DICOM en el estudio abierto
  const inputPdfRef = useRef<HTMLInputElement>(null);
  const [adjuntando, setAdjuntando] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // Dictado en vivo: microfono -> deteccion de voz -> frases -> Whisper
  const micRef = useRef<MicEnVivo | null>(null);
  const detectorRef = useRef<DetectorVozEnVivo | null>(null);
  const colaRef = useRef<Promise<void>>(Promise.resolve()); // frases de a una, en orden
  const [pendientes, setPendientes] = useState(0); // frases esperando a Whisper
  // Ultima frase del dictado, en gris debajo del cuadro: se va escribiendo
  // mientras Whisper la genera y queda visible hasta que empieza la siguiente.
  // Se borra al Detener (cuando termina la ultima frase) o al Cancelar.
  const [fraseEnCurso, setFraseEnCurso] = useState('');
  const pendientesRef = useRef(0);
  const detenidoRef = useRef(false); // se apreto Detener: borrar el gris al terminar
  // Motor de dictado: 'navegador' = reconocimiento local de Chrome (escribe
  // mientras se habla); 'whisper' = Whisper en la PC (respaldo para navegadores
  // sin modo local); null = averiguando. Ver index.ts y DictadoNavegador.ts
  const [motor, setMotor] = useState<'navegador' | 'whisper' | null>(null);
  const motorRef = useRef<'navegador' | 'whisper' | null>(null);
  const instalableRef = useRef(false); // Chrome lo tiene pero falto instalar (se reintenta con el clic)
  const dictadoNavRef = useRef<DictadoNavegador | null>(null);
  // Preparacion de Whisper (empieza al iniciar OHIF, ver index.ts)
  const [dictado, setDictado] = useState<EstadoDictado | null>(null);
  const preparando =
    motor === null || (motor === 'whisper' && (dictado?.fase === 'cargando' || dictado?.fase === 'precalentando'));

  function usarMotor(nuevo: 'navegador' | 'whisper') {
    motorRef.current = nuevo;
    setMotor(nuevo);
    if (nuevo === 'whisper') {
      precargarModelo(); // por si no arranco al iniciar OHIF (o fallo antes)
    }
  }
  const procesandoRef = useRef(false);
  // Cada audio que se procesa tiene un numero; si cambia (Cancelar, cerrar el
  // panel), el resultado de ese audio se descarta
  const solicitudRef = useRef(0);

  // Error de audio: mensaje claro en el panel, el detalle tecnico debajo y el
  // error completo (con su pila) en la consola, con el prefijo [MiniPACS voz]
  function mostrarErrorAudio(err: unknown, porDefecto: string, donde: string) {
    fallo(`error en ${donde}`, err);
    const claro = mensajeDeError(err, porDefecto);
    const detalle = detalleDeError(err);
    setErrorAudio(claro);
    setDetalleAudio(detalle && detalle !== claro ? detalle : null);
  }

  function limpiarErrorAudio() {
    setErrorAudio(null);
    setDetalleAudio(null);
  }

  // Al abrir el panel: empezar a cargar Whisper (elige el modelo segun la PC), asi
  // el primer dictado no espera la descarga. Al cerrarlo: liberar el microfono y
  // descartar lo que este en curso
  useEffect(() => {
    let cerrado = false;
    const desuscribir = suscribirEstado(setDictado);
    estadoDictadoNavegador().then(estado => {
      if (cerrado) {
        return;
      }
      instalableRef.current = estado === 'downloadable' || estado === 'downloading';
      usarMotor(estado === 'available' ? 'navegador' : 'whisper');
    });
    return () => {
      cerrado = true;
      desuscribir();
      solicitudRef.current++;
      micRef.current?.release();
      detectorRef.current?.descartar();
      dictadoNavRef.current?.abort();
    };
  }, []);

  // Cancelar: borra el texto del cuadro (y corta una grabacion o audio en curso).
  const cancelar = () => {
    solicitudRef.current++;
    micRef.current?.release();
    micRef.current = null;
    detectorRef.current?.descartar();
    detectorRef.current = null;
    dictadoNavRef.current?.abort();
    dictadoNavRef.current = null;
    setGrabando(false);
    setFraseEnCurso('');
    setTexto('');
    setMensaje(null);
    setEstadoAudio('');
    limpiarErrorAudio();
  };

  // Guardar y enviar: arma el DICOM SR (TID 2005) y lo manda al PACS.
  // Es el UNICO que envia: grabar o cargar un MP3 solo escriben en el cuadro.
  const guardarYEnviar = async () => {
    setEnviando(true);
    setMensaje(null);
    try {
      await reportService.guardarInforme(texto);
      setTexto('');
      setMensaje({ tipo: 'ok', texto: 'Informe enviado al PACS.' });
    } catch (error) {
      setMensaje({ tipo: 'error', texto: error?.message || 'No se pudo enviar el informe.' });
    } finally {
      setEnviando(false);
    }
  };

  // Adjuntar PDF: abre el selector del equipo y lo manda al PACS como serie nueva
  async function onSeleccionarPdf(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    event.target.value = ''; // permite elegir el mismo PDF de nuevo
    if (!archivo) {
      return;
    }
    if (!archivo.name.toLowerCase().endsWith('.pdf')) {
      setMensaje({ tipo: 'error', texto: 'Seleccione un archivo .pdf' });
      return;
    }
    setAdjuntando(true);
    setMensaje(null);
    try {
      await reportService.adjuntarPdf(archivo);
      setMensaje({ tipo: 'ok', texto: `PDF "${archivo.name}" adjuntado al estudio.` });
    } catch (error) {
      setMensaje({ tipo: 'error', texto: error?.message || 'No se pudo adjuntar el PDF.' });
    } finally {
      setAdjuntando(false);
    }
  }

  // Un solo camino para el microfono y el MP3: los dos llegan aca con su audio.
  // decodificar -> detectar voz (Silero, sin silencios) -> transcribir cada tramo
  // (Whisper) -> agregar al cuadro. Todo en el navegador: el audio no sale de la PC.
  async function procesarGrabacion(blob: Blob) {
    if (procesandoRef.current) {
      return;
    }
    procesandoRef.current = true;
    const solicitud = ++solicitudRef.current;
    const vigente = () => solicitud === solicitudRef.current; // no se cancelo ni se cerro el panel
    setProcesando(true);
    limpiarErrorAudio();
    registro(`procesar audio: ${(blob.size / 1024).toFixed(0)} KB (${blob.type || 'sin tipo'})`);
    try {
      setEstadoAudio('Decodificando audio...');
      const audioPCM = await decodificarAudio(blob);

      // Solo los tramos con voz llegan a Whisper (en los silencios inventa frases)
      setEstadoAudio('Buscando voz...');
      const segmentos = await detectarSegmentosDeVoz(audioPCM);
      if (!vigente()) {
        return;
      }
      if (segmentos.length === 0) {
        throw new Error('No se detectó voz en el audio');
      }

      const partes: string[] = [];
      for (let i = 0; i < segmentos.length; i++) {
        if (!vigente()) {
          return;
        }
        setEstadoAudio(`Transcribiendo ${i + 1} de ${segmentos.length}...`);
        const parte = await transcribirAudio(segmentos[i].audio);
        if (parte) {
          partes.push(parte);
        }
      }
      const transcripcion = partes.join(' ').trim();
      if (!transcripcion) {
        throw new Error('No se reconoció ningún texto');
      }
      if (!vigente()) {
        return;
      }

      // Se agrega al final como parrafo nuevo, sin pisar lo que ya esta
      setTexto(anterior =>
        (anterior.length ? `${anterior}\n\n${transcripcion}` : transcripcion).slice(0, MAX_CARACTERES)
      );
      registro(`texto agregado al informe: ${transcripcion.length} caracteres`);
    } catch (err) {
      if (vigente()) {
        mostrarErrorAudio(err, 'No se pudo transcribir el audio', 'procesar audio');
      }
    } finally {
      procesandoRef.current = false;
      setProcesando(false);
      if (vigente()) {
        setEstadoAudio('');
      }
    }
  }

  // Cargar MP3: abre el selector del equipo; el archivo se lee localmente
  async function onSeleccionarMp3(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    event.target.value = ''; // permite elegir el mismo MP3 de nuevo
    if (!archivo) {
      return;
    }
    if (!archivo.name.toLowerCase().endsWith('.mp3')) {
      limpiarErrorAudio();
      setErrorAudio('Seleccione un archivo .mp3');
      return;
    }
    if (motorRef.current === 'navegador') {
      await procesarConNavegador(archivo);
      return;
    }
    await procesarGrabacion(archivo);
  }

  // Agrega una frase confirmada al cuadro. La primera de cada dictado o archivo
  // empieza un parrafo nuevo; la frase queda en gris hasta la siguiente.
  function agregarFrase(frase: string, primera: { valor: boolean }) {
    const separador = primera.valor ? '\n\n' : ' ';
    primera.valor = false;
    setFraseEnCurso(frase);
    setTexto(anterior => (anterior ? `${anterior}${separador}${frase}` : frase).slice(0, MAX_CARACTERES));
  }

  // Dictado del navegador para el microfono y el MP3: lo provisorio al gris y cada
  // frase confirmada al cuadro. Si el castellano local dejo de estar disponible,
  // se pasa a Whisper.
  function crearDictadoNavegador(solicitud: number, primera: { valor: boolean }, alTerminar: () => void) {
    const vigente = () => solicitud === solicitudRef.current;
    return new DictadoNavegador(
      parcial => vigente() && setFraseEnCurso(parcial),
      frase => vigente() && agregarFrase(frase, primera),
      err => {
        if (!vigente()) {
          return;
        }
        if (err.name === 'language-not-supported') {
          usarMotor('whisper');
        }
        mostrarErrorAudio(err, 'Error en el dictado', 'dictado del navegador');
      },
      () => {
        if (vigente()) {
          setFraseEnCurso('');
          alTerminar();
        }
      }
    );
  }

  // MP3 con el navegador: tarda lo que dura el audio; el texto aparece en gris
  async function procesarConNavegador(archivo: Blob) {
    if (procesandoRef.current) {
      return;
    }
    procesandoRef.current = true;
    const solicitud = ++solicitudRef.current;
    const vigente = () => solicitud === solicitudRef.current;
    setProcesando(true);
    limpiarErrorAudio();
    setFraseEnCurso('');
    setEstadoAudio('Transcribiendo el audio (tarda lo mismo que dura el archivo)...');
    const dictadoNav = crearDictadoNavegador(solicitud, { valor: true }, () => undefined);
    dictadoNavRef.current = dictadoNav;
    try {
      await dictarArchivo(archivo, dictadoNav, vigente);
    } catch (err) {
      if (vigente()) {
        mostrarErrorAudio(err, 'No se pudo transcribir el audio', 'MP3 con el navegador');
      }
    } finally {
      dictadoNavRef.current = null;
      procesandoRef.current = false;
      setProcesando(false);
      if (vigente()) {
        setEstadoAudio('');
      }
    }
  }

  // Dictado en vivo: cada frase (cortada por una pausa) va a Whisper y su texto se
  // agrega al cuadro mientras el medico sigue hablando. Las frases se transcriben
  // de a una y en orden. La primera de cada dictado empieza un parrafo nuevo.
  function transcribirFrase(audio: Float32Array, solicitud: number, primera: { valor: boolean }) {
    setPendientes(n => n + 1);
    pendientesRef.current++;
    colaRef.current = colaRef.current.then(async () => {
      try {
        if (solicitud !== solicitudRef.current) {
          return; // se cancelo o se cerro el panel
        }
        const parte = await transcribirAudio(audio, parcial => {
          if (solicitud === solicitudRef.current) {
            setFraseEnCurso(parcial);
          }
        });
        if (!parte || solicitud !== solicitudRef.current) {
          return;
        }
        setFraseEnCurso(parte); // queda visible hasta la proxima frase
        const separador = primera.valor ? '\n\n' : ' ';
        primera.valor = false;
        setTexto(anterior => (anterior ? `${anterior}${separador}${parte}` : parte).slice(0, MAX_CARACTERES));
      } catch (err) {
        if (solicitud === solicitudRef.current) {
          mostrarErrorAudio(err, 'No se pudo transcribir', 'frase en vivo');
        }
      } finally {
        pendientesRef.current--;
        setPendientes(n => n - 1);
        if (detenidoRef.current && pendientesRef.current === 0) {
          setFraseEnCurso(''); // termino la ultima frase despues de Detener
        }
      }
    });
  }

  function liberarDictado() {
    micRef.current?.release();
    micRef.current = null;
    detectorRef.current = null;
    setGrabando(false);
  }

  // Grabar voz: primer clic empieza a escuchar (pide permiso la primera vez);
  // segundo clic detiene y transcribe la ultima frase
  async function onClickMicrofono() {
    limpiarErrorAudio();
    // Chrome tiene castellano local pero no se instalo al iniciar (puede pedir un
    // clic del usuario): se intenta ahora, con este clic
    if (!grabando && motorRef.current === 'whisper' && instalableRef.current) {
      setEstadoAudio('Instalando el castellano del navegador (solo la primera vez)...');
      const listo = await prepararDictadoNavegador();
      setEstadoAudio('');
      instalableRef.current = false;
      if (listo) {
        usarMotor('navegador');
      }
    }
    if (motorRef.current === 'navegador') {
      onClickMicrofonoNavegador();
      return;
    }
    if (grabando) {
      const detector = detectorRef.current;
      micRef.current?.release(); // deja de escuchar ya
      micRef.current = null;
      setGrabando(false);
      setEstadoAudio('');
      detenidoRef.current = true;
      await detector?.cerrar(); // la ultima frase va a la cola
      detectorRef.current = null;
      if (pendientesRef.current === 0) {
        setFraseEnCurso('');
      }
      return;
    }
    const solicitud = ++solicitudRef.current;
    const primera = { valor: true };
    detenidoRef.current = false;
    setFraseEnCurso('');
    try {
      const detector = new DetectorVozEnVivo(
        audio => transcribirFrase(audio, solicitud, primera),
        err => {
          liberarDictado();
          setEstadoAudio('');
          mostrarErrorAudio(err, 'No se pudo detectar la voz', 'deteccion en vivo');
        }
      );
      detectorRef.current = detector;
      const mic = new MicEnVivo();
      micRef.current = mic;
      await mic.start(bloque => detector.agregar(bloque));
      setGrabando(true);
      setEstadoAudio('Escuchando... hablá con pausas; volvé a apretar para detener');
    } catch (err) {
      liberarDictado();
      setEstadoAudio('');
      mostrarErrorAudio(err, 'Error de micrófono', 'microfono');
    }
  }

  // Grabar voz con el navegador: escribe mientras se habla. Detener deja de
  // escuchar y confirma la ultima frase (el gris se borra al terminar).
  function onClickMicrofonoNavegador() {
    if (grabando) {
      dictadoNavRef.current?.stop();
      dictadoNavRef.current = null;
      setGrabando(false);
      setEstadoAudio('');
      return;
    }
    const solicitud = ++solicitudRef.current;
    setFraseEnCurso('');
    const dictadoNav = crearDictadoNavegador(solicitud, { valor: true }, () => {
      dictadoNavRef.current = null;
      setGrabando(false);
      setEstadoAudio('');
    });
    dictadoNavRef.current = dictadoNav;
    try {
      dictadoNav.start();
      setGrabando(true);
      setEstadoAudio('Escuchando... volvé a apretar para detener');
    } catch (err) {
      dictadoNavRef.current = null;
      mostrarErrorAudio(err, 'Error de micrófono', 'microfono (navegador)');
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h3 className="text-foreground text-lg">Informe médico</h3>

      {/* Los botones pasan a la linea de abajo si el panel es angosto */}
      <div className="flex flex-wrap gap-2">
        <Button
          className="shrink-0 whitespace-nowrap"
          variant={grabando ? 'default' : 'secondary'}
          onClick={onClickMicrofono}
          disabled={procesando || enviando || (preparando && !grabando)}
          aria-pressed={grabando}
        >
          {grabando ? '■ Detener grabación' : '🎤 Grabar voz'}
        </Button>
        <Button
          className="shrink-0 whitespace-nowrap"
          variant="secondary"
          onClick={() => inputMp3Ref.current?.click()}
          disabled={grabando || procesando || enviando || pendientes > 0 || preparando}
        >
          🎵 Cargar MP3
        </Button>
        <input
          ref={inputMp3Ref}
          type="file"
          accept=".mp3,audio/mpeg"
          onChange={onSeleccionarMp3}
          className="hidden"
        />
        <Button
          className="shrink-0 whitespace-nowrap"
          variant="secondary"
          onClick={() => inputPdfRef.current?.click()}
          disabled={grabando || procesando || enviando || adjuntando}
        >
          {adjuntando ? 'Adjuntando...' : '📎 Adjuntar PDF'}
        </Button>
        <input
          ref={inputPdfRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={onSeleccionarPdf}
          className="hidden"
        />
      </div>

      {preparando && (
        <p
          role="status"
          className="text-muted-foreground text-sm"
        >
          {dictado?.fase === 'precalentando'
            ? 'Preparando el dictado... casi listo'
            : `Preparando el dictado... ${dictado?.porcentaje ?? 0} %`}
        </p>
      )}
      {motor === 'navegador' && !estadoAudio && !errorAudio && (
        <p className="text-muted-foreground text-xs">Dictado listo (navegador, en esta PC)</p>
      )}
      {motor === 'whisper' && dictado?.fase === 'listo' && !estadoAudio && pendientes === 0 && dictado.perfil && (
        <p className="text-muted-foreground text-xs">
          Dictado listo ({dictado.perfil.modelo.replace('onnx-community/whisper-', '')},{' '}
          {dictado.perfil.device === 'webgpu' ? 'placa de video' : 'procesador'})
        </p>
      )}
      {(estadoAudio || pendientes > 0) && (
        <p
          role="status"
          className="text-muted-foreground text-sm"
        >
          {estadoAudio}
          {pendientes > 0 && ` Transcribiendo (${pendientes} ${pendientes === 1 ? 'frase' : 'frases'})...`}
        </p>
      )}
      {errorAudio && (
        <div
          role="alert"
          className="text-sm text-red-500"
        >
          <p>{errorAudio}</p>
          {detalleAudio && (
            <p className="text-muted-foreground mt-1 break-all text-xs">
              Detalle técnico: {detalleAudio}
            </p>
          )}
        </div>
      )}

      <div className="relative flex flex-1 flex-col">
        <textarea
          ref={editorRef}
          id="textoInforme"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          maxLength={MAX_CARACTERES}
          disabled={enviando}
          placeholder="Escriba el informe aquí..."
          className="border-input text-foreground bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[250px] w-full flex-1 resize-none rounded border p-3 pb-7 text-base focus-visible:outline-none focus-visible:ring-1 disabled:opacity-50"
        />
        <span className="text-muted-foreground pointer-events-none absolute bottom-2 right-3 text-sm">
          {texto.length}/{MAX_CARACTERES}
        </span>
      </div>
      {fraseEnCurso && (
        <p
          aria-live="polite"
          className="text-muted-foreground -mt-1 text-sm italic"
        >
          {fraseEnCurso}…
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={cancelar}
          disabled={enviando || adjuntando || grabando || procesando || pendientes > 0}
        >
          Cancelar
        </Button>
        <Button
          variant="default"
          onClick={guardarYEnviar}
          disabled={enviando || adjuntando || grabando || procesando || pendientes > 0 || !texto.trim()}
        >
          {enviando ? 'Enviando...' : 'Guardar y enviar'}
        </Button>
      </div>

      {mensaje && (
        <p className={mensaje.tipo === 'ok' ? 'text-sm text-green-500' : 'text-sm text-red-500'}>
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
