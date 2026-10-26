// Config de DESARROLLO contra el PACS LOCAL (stack deploy-windows de esta PC).
// Igual a tecnopacs.js (Contabo) salvo la URL del servidor. Para pruebas de
// escritura (Guardar y enviar), asi no se ensucia el PACS online.
// Uso: $env:APP_CONFIG = "config/tecnopacs-local.js"; yarn workspace @ohif/app dev

window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],
  showStudyList: true,
  // Mientras se consulta la lista se muestra el indicador de carga y no el
  // cartel "No studies" (que queda solo para consulta terminada y vacia).
  showLoadingIndicator: true,

  // ------------------------------------------------------------------
  // Panel de informe (extension @minipacs/extension-report) en el modo
  // "Basic Viewer" (longitudinal), sin tocar el codigo del modo: OHIF
  // aplica estos cambios al modo al arrancar (immutability-helper).
  // $push = agregar al final de la lista de pestanias de la derecha.
  // ------------------------------------------------------------------
  modesConfiguration: {
    '@ohif/mode-longitudinal': {
      // Manejador de nuestros informes (TID 2005) PRIMERO: OHIF prueba los
      // manejadores en orden; los SR que no son nuestros siguen al de OHIF.
      sopClassHandlers: {
        $unshift: ['@minipacs/extension-report.sopClassHandlerModule.informe-tid2005'],
      },
      routes: {
        0: {
          layoutInstance: {
            props: {
              rightPanels: {
                $push: [
                  '@minipacs/extension-report.panelModule.report'
                ],
              },
              // Visor propio (en castellano) para los informes TID 2005
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

      // Boton "Informe" en la barra: ejecuta el comando openReport de la
      // extension, que abre la pestania del panel de informe.
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

      // Ubica el boton al final de la barra principal.
      toolbarSections: {
        primary: {
          $push: ['Report'],
        },
      },
    },
  },

  // ------------------------------------------------------------------
  // Autenticacion OIDC nativa contra Keycloak.
  // Es el equivalente al "Authentication Method" de Weasis: mismas URLs,
  // mismo realm. Sin proxy: el navegador obtiene su propio token y se lo
  // manda directamente a dcm4chee.
  //
  // El cliente 'ohif' es PUBLICO y no lleva client_secret: una aplicacion
  // que corre en el navegador no puede guardar un secreto. La seguridad la
  // aporta PKCE, que hay que activar en Keycloak (Advanced -> S256).
  // ------------------------------------------------------------------
  oidc: [
    {
      authority: 'https://desktop-ltsh0bh.tail264318.ts.net/realms/dcm4che',
      client_id: 'ohif',
      redirect_uri: '/callback',
      response_type: 'code',
      scope: 'openid profile email',
      post_logout_redirect_uri: '/logout-redirect.html',
      revoke_uri:
        'https://desktop-ltsh0bh.tail264318.ts.net/realms/dcm4che/protocol/openid-connect/revoke',
      automaticSilentRenew: true,
      revokeAccessTokenOnSignout: true,
    },
  ],

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'dcm4chee-arc (local)',
        name: 'DCM4CHEE',

        // Directo al archive, sin proxy en el medio. dcm4chee ya devuelve
        // los headers CORS necesarios y arma bien las Retrieve URLs.
        wadoUriRoot: 'https://desktop-ltsh0bh.tail264318.ts.net/dcm4chee-arc/aets/DCM4CHEE/wado',
        qidoRoot: 'https://desktop-ltsh0bh.tail264318.ts.net/dcm4chee-arc/aets/DCM4CHEE/rs',
        wadoRoot: 'https://desktop-ltsh0bh.tail264318.ts.net/dcm4chee-arc/aets/DCM4CHEE/rs',

        qidoSupportsIncludeField: true,
        supportsReject: true,
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
