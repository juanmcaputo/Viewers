@echo off
rem Dev server de OHIF en HTTPS (para usarlo desde el celular: crypto.subtle y microfono exigen contexto seguro).
rem Certificados en %USERPROFILE%\.ohif-dev-certs (CA propia + certificado con SAN 192.168.1.132/localhost/127.0.0.1).
rem Para modo http normal: yarn workspace @ohif/app dev (sin estos flags).
set APP_CONFIG=config/tecnopacs-local.js
cd /d "%~dp0"
yarn workspace @ohif/app dev --server-type https --server-options-key "%USERPROFILE%\.ohif-dev-certs\ohif-dev.key" --server-options-cert "%USERPROFILE%\.ohif-dev-certs\ohif-dev.crt" --server-options-ca "%USERPROFILE%\.ohif-dev-certs\ca.crt"
