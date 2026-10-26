import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';
import getViewportModule from './getViewportModule';
import { prepararDictadoNavegador } from './services/DictadoNavegador';
import { registro } from './services/registroVoz';

const id = '@minipacs/extension-report';
const version = '0.1.0';

export default {
  id,
  version,
  // Al iniciar OHIF: SOLO intentar tener listo el castellano local del navegador
  // (Chrome 155+, escribe mientras se habla). Whisper NO se carga aca: bajar los
  // modelos (decenas de MB por la misma conexion que las imagenes) y compilar los
  // programas de la placa de video compiten con la carga del visor (visor negro,
  // frames lentisimos) y ademas OHIF se recarga varias veces al iniciar sesion.
  //  - Chrome con la API local: si el paquete de idioma no esta, se intenta
  //    instalar sin molestar; si Chrome exige un clic (o tarda), se instala al
  //    apretar Grabar voz / Cargar MP3 y Whisper ni se carga.
  //  - Navegador sin la API (Edge, Firefox, Chrome viejo): Whisper (y Silero) se
  //    preparan cuando el medico abre el panel de informe (ReportPanel.tsx).
  preRegistration() {
    prepararDictadoNavegador().then(listo => {
      registro(
        listo
          ? 'dictado: se usa el reconocimiento local del navegador'
          : 'dictado: el motor se prepara al abrir el panel de informe o al dictar'
      );
    });
  },
  getPanelModule,
  getCommandsModule,
  getSopClassHandlerModule,
  getViewportModule,
};
