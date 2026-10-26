# syntax=docker/dockerfile:1.7-labs
# This dockerfile is used to publish the `ohif/app` image on dockerhub.
#
# It's a good example of how to build our static application and package it
# with a web server capable of hosting it as static content.
#
# docker build
# --------------
# If you would like to use this dockerfile to build and tag an image, make sure
# you set the context to the project's root directory:
# https://docs.docker.com/engine/reference/commandline/build/
#
#
# SUMMARY
# --------------
# This dockerfile has two stages:
#
# 1. Building the React application for production
# 2. Setting up our Nginx (Alpine Linux) image w/ step one's output
#


# syntax=docker/dockerfile:1.7-labs
# This dockerfile is used to publish the `ohif/app` image on dockerhub.
#
# It's a good example of how to build our static application and package it
# with a web server capable of hosting it as static content.
#
# docker build
# --------------
# If you would like to use this dockerfile to build and tag an image, make sure
# you set the context to the project's root directory:
# https://docs.docker.com/engine/reference/commandline/build/
#
#
# SUMMARY
# --------------
# This dockerfile is used as an input for a second stage to make things run faster.
#


# Stage 1: Build the application
# docker build -t ohif/viewer:latest .
#
# MiniPACS: se instala y se compila con yarn classic 1.22.22 y yarn.lock (igual que
# en desarrollo), no con bun. Motivo: la extension minipacs-report usa
# @huggingface/transformers 3.8.1, que trae su propio onnxruntime-web 1.22 anidado en
# node_modules/@huggingface/transformers/node_modules, mientras OHIF usa el 1.17.1 de
# la raiz; la regla "MiniPACS" de .webpack/webpack.base.js depende de esa disposicion
# (el hoisting de bun es distinto). Node 22 (desarrollo usa 22.23.2).
FROM node:22.23.2-slim as builder

RUN apt-get update && apt-get install -y build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /usr/src/app
WORKDIR /usr/src/app
ENV PATH=/usr/src/app/node_modules/.bin:$PATH
# La imagen de node ya trae yarn classic; queda registrado cual es
RUN node --version && yarn --version

# Do an initial install and then a final install
COPY package.json yarn.lock preinstall.js lerna.json ./
COPY --parents ./addOns/package.json ./addOns/*/*/package.json ./extensions/*/package.json ./modes/*/package.json ./platform/*/package.json ./
# Run the install before copying the rest of the files

# Cypress no hace falta para compilar (descarga un binario de cientos de MB).
# Se limpia la cache de yarn en el mismo RUN para que no quede en la capa.
# Nota: el "bun add ajv@8.12.0" original corregia el hoisting de bun (ajv 6 en la
# raiz y schema-utils 4 no hallaba ajv 8); con yarn.lock cada paquete recibe su ajv
# (6.12.6 en la raiz, 8.17.1 anidado en schema-utils 4), asi que no hace falta.
# Al final se verifica la disposicion de onnxruntime-web que pide la regla MiniPACS.
RUN CYPRESS_INSTALL_BINARY=0 yarn install --frozen-lockfile --network-timeout 600000 \
    && yarn cache clean \
    && ls -d node_modules/onnxruntime-web node_modules/@huggingface/transformers/node_modules/onnxruntime-web \
    && grep -m1 '"version"' node_modules/onnxruntime-web/package.json \
    && grep -m1 '"version"' node_modules/@huggingface/transformers/node_modules/onnxruntime-web/package.json
# Copy the local directory
COPY --link --exclude=yarn.lock --exclude=package.json --exclude=Dockerfile . .

# Build here
# After install it should hopefully be stable until the local directory changes
ENV QUICK_BUILD true
# ENV GENERATE_SOURCEMAP=false
ARG APP_CONFIG=config/default.js
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}

RUN yarn run show:config
RUN yarn run build

# Parche de produccion (MiniPACS): en el build de produccion webpack evalua
# "typeof __filename" como "string" y terser lo pliega a "true&&(e=e||__filename)" en
# el codigo emscripten de onnxruntime-web 1.17.1 (cornerstone). En el navegador
# __filename no existe: ReferenceError al cargar el chunk, la app queda colgada en
# /callback y nunca arranca (en desarrollo no pasa, no hay minificado). Se restituye
# la guarda original. El ultimo grep hace fallar el build si quedara algun caso.
RUN grep -rlF 'true&&(e=e||__filename)' platform/app/dist --include=*.js \
    | xargs -r sed -i 's/true&&(e=e||__filename)/"undefined"!=typeof __filename\&\&(e=e||__filename)/g' \
    && ! grep -rqF 'true&&(e=e||__filename)' platform/app/dist --include=*.js

# Precompress files
RUN chmod u+x .docker/compressDist.sh
RUN ./.docker/compressDist.sh

# Stage 3: Bundle the built application into a Docker container
# which runs Nginx using Alpine Linux
FROM nginxinc/nginx-unprivileged:1.27-alpine as final
#RUN apk add --no-cache bash
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}
ARG PORT=80
ENV PORT=${PORT}
RUN rm /etc/nginx/conf.d/default.conf
USER nginx
COPY --chown=nginx:nginx .docker/Viewer-v3.x /usr/src
RUN chmod 777 /usr/src/entrypoint.sh
COPY --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html${PUBLIC_URL}
# Copy paths that are renamed/redirected generally
# Microscopy libraries depend on root level include, so must be copied
COPY --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

# In entrypoint.sh, app-config.js might be overwritten, so chmod it to be writeable.
# The nginx user cannot chmod it, so change to root.
USER root
RUN chown -R nginx:nginx /usr/share/nginx/html && chmod -R 777 /usr/share/nginx/html
USER nginx
ENTRYPOINT ["/usr/src/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
