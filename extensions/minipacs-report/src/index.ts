import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';
import getViewportModule from './getViewportModule';
import { precargarModelo } from './services/SpeechTranscriber';
import { obtenerModelo as obtenerSilero } from './services/DetectorVoz';
import { prepararDictadoNavegador } from './services/DictadoNavegador';
import { registro } from './services/registroVoz';

const id = '@minipacs/extension-report';
const version = '0.1.0';

export default {
  id,
  version,
  // Al iniciar OHIF: empezar a preparar el dictado (elegir modelo, cargarlo y
  // precalentarlo) en su hilo aparte, en paralelo con la carga de la pagina.
  // Cuando el medico abre el panel de informe ya esta listo.
  preRegistration() {
    // 1. Si el navegador reconoce castellano LOCALMENTE (Chrome 155+), ese es el
    //    motor: escribe mientras se habla. Si falta el paquete de idioma, se
    //    instala en segundo plano (si Chrome pide un clic, se reintenta al
    //    apretar Grabar voz). En ese caso Whisper no se carga: ahorra memoria.
    // 2. Si no (Edge, Firefox, Chrome viejo o fallo la instalacion): Whisper y
    //    Silero, precargados en paralelo con la carga de OHIF.
    prepararDictadoNavegador().then(listo => {
      if (listo) {
        registro('dictado: se usa el reconocimiento local del navegador');
        return;
      }
      precargarModelo();
      // Silero (deteccion de voz) corre en la pagina: se carga cuando el navegador
      // esta libre, para no competir con la carga de OHIF
      const cuandoEsteLibre = (window as any).requestIdleCallback || ((tarea: () => void) => setTimeout(tarea, 3000));
      cuandoEsteLibre(() => obtenerSilero().catch(() => undefined), { timeout: 15000 });
    });
  },
  getPanelModule,
  getCommandsModule,
  getSopClassHandlerModule,
  getViewportModule,
};
