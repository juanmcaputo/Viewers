// MiniPACS - servidor de desarrollo PARALELO (por ejemplo el OHIF del paciente en :3003 mientras
// corre el del profesional en :3000, los dos desde este mismo fork).
//
// Por que hace falta: el dev server normal (webpack.pwa.js) escribe la salida en DISCO
// (devMiddleware.writeToDisk: true) en platform/app/dist y sirve desde ahi, y al arrancar BORRA esa
// carpeta (CleanWebpackPlugin). Si se levanta un segundo "yarn workspace @ohif/app dev", el segundo
// borra dist y sobrescribe dist/app-config.js y dist/app.js: el primero pasa a servir la config
// del segundo (el profesional veria la config del paciente).
//
// Este archivo usa la MISMA config (webpack.pwa.js) con tres cambios:
//   - sirve desde MEMORIA (writeToDisk: false): no escribe nada en platform/app/dist;
//   - sin CleanWebpackPlugin: no borra platform/app/dist;
//   - cache de webpack en MEMORIA: no comparte (ni pisa) la del otro dev server y no ocupa disco
//     (la cache en disco del dev server normal pesa ~3 GB; el 2026-10-28 el disco C: se lleno).
//     Contra: cada arranque compila de cero (~3 min).
// Lo unico que sigue escribiendo en disco es src/pluginImports.js (lo genera webpack.pwa.js a partir
// de pluginConfig.json; el contenido es el mismo para los dos).
//
// OJO memoria: dos dev servers de OHIF a la vez usan varios GB de RAM; con poca RAM Windows agranda
// pagefile.sys en C: y puede llenar el disco.
//
// Uso (PowerShell, desde ohif-customs\Viewers):
//   $env:APP_CONFIG = "config/tecnopacs-paciente-local.js"; $env:OHIF_PORT = "3003"; $env:OHIF_OPEN = "false"
//   $env:OHIF_PROXY_PASE = "http://localhost:7070"   # opcional: la puerta al servicio de pase (ver abajo)
//   yarn workspace @ohif/app dev:paralelo
//
// OHIF_PROXY_PASE: hace de puerta (lo que en Docker hara Caddy) para probar el servicio de pase desde el
// portal: /pase, /entrar y /dcm4chee-arc van al servicio y el resto lo sirve este OHIF, todo en el mismo
// origen, asi la cookie del pase viaja con los pedidos del visor. Sin changeOrigin: el servicio recibe
// Host = localhost:3003 y dcm4chee arma los links (BulkDataURI del PDF) hacia esta puerta.
// Con OHIF_PROXY_PASE tambien acepta el Host de Tailscale (*.ts.net): para el HTTPS local con
// "tailscale serve --https=10000 http://127.0.0.1:3003" (y la puerta del medico :8443 -> 3005).
// Ver Documentacion/SERVICIO_PASE/SERVICIO_PASE.md.
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const configPwa = require('./webpack.pwa.js');

module.exports = (env, argv) => {
  const config = configPwa(env, argv);

  config.plugins = config.plugins.filter(plugin => !(plugin instanceof CleanWebpackPlugin));

  config.devServer = {
    ...config.devServer,
    devMiddleware: { ...(config.devServer.devMiddleware || {}), writeToDisk: false },
  };

  if (process.env.OHIF_PROXY_PASE) {
    config.devServer.proxy = [
      { context: ['/pase', '/entrar', '/dcm4chee-arc'], target: process.env.OHIF_PROXY_PASE, changeOrigin: false },
    ];
    // Sin esto el dev server contesta "Invalid Host header" a lo que llega por Tailscale serve (que
    // conserva el Host). localhost y las IP las acepta siempre; ".ts.net" = cualquier nombre de Tailscale.
    const permitidos = Array.isArray(config.devServer.allowedHosts) ? config.devServer.allowedHosts : [];
    config.devServer.allowedHosts = [...new Set([...permitidos, 'localhost', '127.0.0.1', '.ts.net'])];
  }

  config.cache = { type: 'memory' };

  return config;
};
