// Config del OHIF del PACIENTE, de DESARROLLO contra el PACS LOCAL (stack deploy-windows de esta PC).
// La del profesional es tecnopacs-local.js (no cambia). La de Contabo sera deploy-contabo/app-config-paciente.js.
//
// Uso (en otro puerto, para no pisar el OHIF de desarrollo del profesional), desde ohif-customs\Viewers:
//   $env:APP_CONFIG = "config/tecnopacs-paciente-local.js"; $env:OHIF_PORT = "3003"; $env:OHIF_OPEN = "false"
//   $env:OHIF_PROXY_PASE = "http://localhost:7070"; yarn workspace @ohif/app dev:paralelo
// con el servicio de pase corriendo en el 7070. Se entra desde el portal ("Ver estudio"), que pide el pase
// y abre https://desktop-ltsh0bh.tail264318.ts.net:10000/entrar?codigo=...; el servicio pone la cookie y
// redirige a /paciente. El HTTPS lo pone Tailscale serve (lo corre el usuario, solo la tailnet):
//   tailscale serve --bg --https=10000 http://127.0.0.1:3003
// Para volver a http://localhost:3003: las tres raices de abajo con http://localhost:3003,
// publico.protocolo=http en servicio-pase/config/local.properties y MINIPACS_PASE_URL en el .env del portal.
//
// Diferencias con la del profesional:
//   - sin lista de estudios (el paciente llega con el link del portal);
//   - sin el panel de informe (modesConfiguration del longitudinal): esta puerta usa el modo
//     @minipacs/mode-paciente (modes/minipacs-paciente), que ya trae su barra y su pantalla;
//   - supportsReject: false (el visor no ofrece borrar series);
//   - SIN login de Keycloak (sin oidc): el acceso lo da la cookie del servicio de pase.
//
// Paso 1 (hecho): login de Keycloak y dcm4chee directo, para probar la VISTA.
// Paso 2 y 3 (hoy): sin oidc; los pedidos DICOMweb van a esta misma puerta (:10000 -> 127.0.0.1:3003), que los pasa
// al servicio de pase (webpack.dev-paralelo.js, OHIF_PROXY_PASE). Mismo origen: la cookie viaja sola.
// El servicio solo deja ver el estudio del pase (Documentacion/SERVICIO_PASE/SERVICIO_PASE.md).
//
// CANDADO: en esta puerta solo existe la ruta /paciente.
// La imagen trae compilados TODOS los modos de pluginConfig.json y cada uno crea su ruta con su
// routeName (/viewer, /basic, /segmentation, ...). Para que el paciente no pueda escribir /viewer y
// cargar el visor completo, aca se "anulan" los demas modos:
//   - appInit.js carga primero los modos de ESTA lista (appConfig.modes) y despues los de
//     pluginConfig.json, y si dos tienen el mismo id se queda con el PRIMERO;
//   - cada "modo anulado" tiene el id de un modo real y un modeFactory que devuelve null, y
//     appInit descarta los modos null => el modo real queda tapado y no crea ninguna ruta.
// Resultado: /viewer, /basic, /segmentation, etc. muestran "Error (404)".
// (modesConfiguration con routes: [] NO sirve: la ruta sale de routeName, no de routes; y
// segmentation y preclinical-4d ignoran modesConfiguration.)
// OJO: si se agrega un modo nuevo a pluginConfig.json, hay que sumarlo a esta lista.
const MODOS_ANULADOS = [
  '@ohif/mode-longitudinal', // /viewer (el del profesional)
  '@ohif/mode-basic', // /basic (el modo paciente usa su CODIGO, no su ruta: no se rompe)
  '@ohif/mode-segmentation', // /segmentation
  '@ohif/mode-tmtv', // /tmtv
  '@ohif/mode-microscopy', // /microscopy
  '@ohif/mode-preclinical-4d', // /dynamic-volume
  '@ohif/mode-ultrasound-pleura-bline', // /usAnnotation
];

window.config = {
  routerBasename: '/',
  extensions: [],
  modes: MODOS_ANULADOS.map(id => ({ id, modeFactory: () => null })),
  showStudyList: false,
  // Sin el cartel "for investigational use only" de OHIF (abajo, sobre el visor).
  investigationalUseDialog: { option: 'never' },
  showLoadingIndicator: true,

  // Sin oidc: no hay login. Sin la cookie del pase, el servicio contesta 401 y el visor no carga nada.

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'dcm4chee-arc (por el servicio de pase)',
        name: 'DCM4CHEE',
        // Esta misma puerta (Tailscale serve :10000 -> 127.0.0.1:3003): el dev server pasa /dcm4chee-arc al
        // servicio de pase (OHIF_PROXY_PASE). El servicio solo atiende .../rs: lo que vaya a /wado da 403
        // (con wadors no se usa).
        wadoUriRoot: 'https://desktop-ltsh0bh.tail264318.ts.net:10000/dcm4chee-arc/aets/DCM4CHEE/wado',
        qidoRoot: 'https://desktop-ltsh0bh.tail264318.ts.net:10000/dcm4chee-arc/aets/DCM4CHEE/rs',
        wadoRoot: 'https://desktop-ltsh0bh.tail264318.ts.net:10000/dcm4chee-arc/aets/DCM4CHEE/rs',
        qidoSupportsIncludeField: true,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
      },
    },
  ],

  defaultDataSourceName: 'dicomweb',
};
