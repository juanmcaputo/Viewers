// Config del OHIF del MEDICO que entra DESDE EL PORTAL por el servicio de pase, de DESARROLLO contra el PACS LOCAL.
// Es tecnopacs-local.js (OHIF profesional completo: lista de estudios, panel de informe) con dos cambios:
//   - SIN login de Keycloak (sin oidc): el acceso lo da la cookie del servicio de pase;
//   - los pedidos DICOMweb van a la puerta del medico (Tailscale serve :8443 -> 127.0.0.1:3005), que los
//     pasa al servicio de pase.
// El medico que entra directo (sin portal) sigue usando tecnopacs-local.js, con Keycloak.
//
// No se compila aparte: la sirve la puerta de prueba servicio-pase/prueba-local/puerta-medico.cjs como
// /app-config.js, delante del OHIF de desarrollo del :3003. La firma del informe sale de GET /pase/yo
// (extensions/minipacs-report, ReportService). Ver Documentacion/SERVICIO_PASE/SERVICIO_PASE.md.
//
// HTTPS: se entra por https://desktop-ltsh0bh.tail264318.ts.net:8443 (lo corre el usuario, solo la tailnet):
//   tailscale serve --bg --https=8443 http://127.0.0.1:3005
// Para volver a http://127.0.0.1:3005: las tres raices de abajo con http://127.0.0.1:3005,
// publico.protocolo=http en servicio-pase/config/local.properties y MINIPACS_PASE_URL_MEDICO en el .env del portal.
//
// COOKIES: la puerta del paciente (:10000) y la del medico (:8443) tienen el MISMO nombre y el navegador
// comparte las cookies entre puertos: la cookie del pase de una pisa la de la otra. Para probar las dos a la
// vez: paciente en una ventana normal y medico en una ventana PRIVADA (o en otro navegador).

window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],
  showStudyList: true,
  // Sin el cartel "for investigational use only" de OHIF (abajo, sobre el visor).
  investigationalUseDialog: { option: 'never' },
  showLoadingIndicator: true,

  // Panel de informe en el modo longitudinal: igual que tecnopacs-local.js.
  modesConfiguration: {
    '@ohif/mode-longitudinal': {
      sopClassHandlers: {
        $unshift: ['@minipacs/extension-report.sopClassHandlerModule.informe-tid2005'],
      },
      routes: {
        0: {
          layoutInstance: {
            props: {
              rightPanels: {
                $push: ['@minipacs/extension-report.panelModule.report'],
              },
              viewports: {
                $push: [
                  {
                    namespace: '@minipacs/extension-report.viewportModule.informe-tid2005',
                    displaySetsToDisplay: [
                      '@minipacs/extension-report.sopClassHandlerModule.informe-tid2005',
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      toolbarButtons: {
        $push: [
          {
            id: 'Report',
            uiType: 'ohif.toolButton',
            props: {
              icon: 'dicom-tag-browser',
              label: 'Informe',
              tooltip: 'Abrir informe médico',
              commands: {
                commandName: 'openReport',
                context: 'DEFAULT',
              },
              evaluate: 'evaluate.action',
            },
          },
        ],
      },
      toolbarSections: {
        primary: {
          $push: ['Report'],
        },
      },
    },
  },

  // Sin oidc: no hay login. Sin la cookie del pase, el servicio contesta 401 y el visor no carga nada.

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'dcm4chee-arc (medico por el servicio de pase)',
        name: 'DCM4CHEE',
        // La puerta del medico (Tailscale serve :8443 -> 127.0.0.1:3005) pasa /dcm4chee-arc al servicio de
        // pase. El servicio solo atiende .../rs: lo que vaya a /wado da 403 (con wadors no se usa).
        wadoUriRoot: 'https://desktop-ltsh0bh.tail264318.ts.net:8443/dcm4chee-arc/aets/DCM4CHEE/wado',
        qidoRoot: 'https://desktop-ltsh0bh.tail264318.ts.net:8443/dcm4chee-arc/aets/DCM4CHEE/rs',
        wadoRoot: 'https://desktop-ltsh0bh.tail264318.ts.net:8443/dcm4chee-arc/aets/DCM4CHEE/rs',
        qidoSupportsIncludeField: true,
        // Sin rechazo de series: el servicio solo deja pasar el POST de STOW (guardar informes).
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
