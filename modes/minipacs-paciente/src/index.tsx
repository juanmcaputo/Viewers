/**
 * MiniPACS - modo del PACIENTE.
 *
 * Mismo patron que el modo longitudinal de OHIF: reutiliza el modo "basic" (visores, manejadores
 * de SOP Class, grupos de herramientas, protocolo de colgado) y cambia SOLO:
 *   - la barra: zoom +/-, zoom, mover, longitud, angulo, guardar imagen, negativo, rotar y reset;
 *   - la pantalla: miniaturas de series a la izquierda y NADA a la derecha (sin el panel de
 *     informe, sin lista de mediciones: las mediciones se dibujan pero no hay como guardarlas);
 *   - los atajos de teclado: solo los de esas herramientas (los de OHIF incluyen segmentacion,
 *     ventana/nivel, etc.);
 *   - el boton izquierdo del mouse: en el basic es ventana/nivel (brillo/contraste); aca es "Mover"
 *     y ventana/nivel queda deshabilitado;
 *   - que se puede abrir: imagenes, video y los INFORMES como documento en el visor (doble clic en
 *     la miniatura): el de texto (SR TID 2005, con el visor de solo lectura de la extension del
 *     informe) y el PDF. Segmentaciones, RT y los SR de mediciones de OHIF no se abren (sus
 *     miniaturas aparecen como no soportadas).
 *
 * URL: /paciente?StudyInstanceUIDs=<uid>. Oculto en la lista de estudios (hide: true): a los
 * profesionales no les aparece; el paciente llega con el link del portal.
 *
 * La SEGURIDAD no esta aca: esconder botones no impide pedir datos. Que el paciente solo vea el
 * estudio que abrio desde el portal lo garantiza el servicio de pase, que filtra cada pedido
 * DICOMweb (Documentacion/SERVICIO_PASE/SERVICIO_PASE.md del repo principal).
 */
import { Icons } from '@ohif/ui-next';
import { defaults, ToolbarService } from '@ohif/core';
import {
  basicLayout,
  basicRoute,
  cornerstone,
  dicompdf,
  dicomvideo,
  extensionDependencies,
  mode as basicMode,
  modeInstance as basicModeInstance,
  ohif,
  onModeEnter as basicOnModeEnter,
  toolbarButtons as botonesBasic,
} from '@ohif/mode-basic';
import { id } from './id';
import { IconoAcercar, IconoAlejar } from './iconos';

const { TOOLBAR_SECTIONS } = ToolbarService;

Icons.addIcon('minipacs-zoom-in', IconoAcercar);
Icons.addIcon('minipacs-zoom-out', IconoAlejar);

/** Botones nuevos: OHIF tiene los comandos scaleUpViewport / scaleDownViewport pero no los botones. */
const botonesNuevos = [
  {
    id: 'ZoomIn',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'minipacs-zoom-in',
      label: 'Acercar',
      tooltip: 'Acercar (+)',
      commands: 'scaleUpViewport',
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'ZoomOut',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'minipacs-zoom-out',
      label: 'Alejar',
      tooltip: 'Alejar (-)',
      commands: 'scaleDownViewport',
      evaluate: 'evaluate.action',
    },
  },
];

/**
 * Textos en castellano para los botones que OHIF no traduce (en la traduccion "es" de OHIF 3.12
 * "Capture" y "Reset View" quedan en ingles). Solo cambia el texto, no el comportamiento.
 */
const TEXTOS = {
  Capture: { label: 'Guardar imagen', tooltip: 'Guardar la imagen en la PC (JPG o PNG)' },
  Reset: { label: 'Restablecer', tooltip: 'Volver a la vista original (espacio)' },
};

/** Todos los botones del basic (se registran; solo se MUESTRAN los de toolbarSections) + los nuevos. */
export const toolbarButtons = [
  ...botonesBasic.map(boton =>
    TEXTOS[boton.id] ? { ...boton, props: { ...boton.props, ...TEXTOS[boton.id] } } : boton
  ),
  ...botonesNuevos,
];

/** Que boton va en cada barra. Las secciones se ponen TODAS, aunque esten vacias, para no heredar nada. */
export const toolbarSections = {
  [TOOLBAR_SECTIONS.primary]: [
    'ZoomIn',
    'ZoomOut',
    'Zoom', // arrastrar para acercar/alejar
    'Pan', // mover (la flecha de 4 puntas)
    'Length', // medir distancia
    'Angle', // medir angulo
    'Capture', // guardar la imagen en la PC (no escribe en el PACS)
    'invert', // negativo
    'rotate-right', // girar 90 grados
    'Reset', // volver a la vista original
  ],
  [TOOLBAR_SECTIONS.viewportActionMenu.topLeft]: [],
  [TOOLBAR_SECTIONS.viewportActionMenu.topRight]: ['modalityLoadBadge', 'navigationComponent'],
  [TOOLBAR_SECTIONS.viewportActionMenu.bottomLeft]: [],
  [TOOLBAR_SECTIONS.viewportActionMenu.bottomMiddle]: [],
};

/** Herramientas que se pueden activar con teclado (setToolActive) en este modo. */
const HERRAMIENTAS_CON_ATAJO = ['Zoom', 'Pan', 'Length', 'Angle'];
/** Comandos con atajo permitidos: los mismos que la barra, mas moverse entre imagenes. */
const COMANDOS_CON_ATAJO = [
  'scaleUpViewport', // +
  'scaleDownViewport', // -
  'fitViewportToWindow', // =
  'rotateViewportCW', // r
  'invertViewport', // i
  'resetViewport', // espacio
  'nextImage', // flecha abajo
  'previousImage', // flecha arriba
  'firstImage', // inicio
  'lastImage', // fin
  'cancelMeasurement', // esc
  'deleteActiveAnnotation', // borrar la medicion seleccionada
];

/** Los atajos por defecto de OHIF, filtrados (no se reescriben: se conserva su formato). */
export const atajosPaciente = defaults.hotkeyBindings.filter(
  atajo =>
    COMANDOS_CON_ATAJO.includes(atajo.commandName) ||
    (atajo.commandName === 'setToolActive' &&
      HERRAMIENTAS_CON_ATAJO.includes(atajo.commandOptions?.toolName))
);

/** Grupos de herramientas que crea el basic (initToolGroups) con ventana/nivel en el boton izquierdo. */
const GRUPOS_CON_VENTANA_NIVEL = ['default', 'SRToolGroup', 'mpr'];

/**
 * Al entrar: lo mismo que el basic (grupos de herramientas y barra, que toma de this.toolbarButtons
 * y this.toolbarSections, o sea los de este modo), despues:
 *   - boton izquierdo = Mover (en el basic es ventana/nivel, que el paciente no tiene);
 *   - atajos reducidos. OHIF aplica 'ohif.hotkeyBindings' DESPUES de onModeEnter (Mode.tsx) y la
 *     personalizacion es de alcance "Mode": al salir del modo se descarta.
 */
function onModeEnter(args) {
  basicOnModeEnter.call(this, args);
  const { servicesManager, extensionManager } = args;
  const { customizationService, toolGroupService } = servicesManager.services;

  const { toolNames, Enums } = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  ).exports;
  for (const idGrupo of GRUPOS_CON_VENTANA_NIVEL) {
    const grupo = toolGroupService.getToolGroup(idGrupo);
    if (!grupo?.hasTool(toolNames.WindowLevel)) {
      continue;
    }
    grupo.setToolDisabled(toolNames.WindowLevel);
    if (grupo.hasTool(toolNames.Pan)) {
      grupo.setToolActive(toolNames.Pan, {
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      });
    }
  }

  customizationService.setCustomizations({
    'ohif.hotkeyBindings': { $set: atajosPaciente },
  });
}

/** El informe de texto: manejador y visor de la extension del informe (los mismos del profesional). */
const informe = {
  sopClassHandler: '@minipacs/extension-report.sopClassHandlerModule.informe-tid2005',
  viewport: '@minipacs/extension-report.viewportModule.informe-tid2005',
};

/**
 * Que series se pueden abrir: imagenes, video e informes (texto y PDF). El orden importa: el
 * informe va primero, como en el profesional (toma solo los SR TID 2005); video antes que
 * imagenes, igual que en el basic. Sin SEG/RT/PMAP ni los SR de mediciones de OHIF.
 */
const manejadoresPaciente = [
  informe.sopClassHandler,
  dicomvideo.sopClassHandler,
  ohif.sopClassHandler,
  ohif.wsiSopClassHandler,
  dicompdf.sopClassHandler,
];

/**
 * Pantalla: la del basic, sin panel derecho (sin segmentacion ni mediciones) y con un visor por
 * cada cosa que se puede abrir: imagenes/video, informe de texto y PDF.
 */
export const layoutPaciente = {
  ...basicLayout,
  props: {
    ...basicLayout.props,
    rightPanels: [],
    rightPanelClosed: true,
    viewports: [
      {
        namespace: cornerstone.viewport,
        displaySetsToDisplay: [
          ohif.sopClassHandler,
          dicomvideo.sopClassHandler,
          ohif.wsiSopClassHandler,
        ],
      },
      {
        namespace: informe.viewport,
        displaySetsToDisplay: [informe.sopClassHandler],
      },
      {
        namespace: dicompdf.viewport,
        displaySetsToDisplay: [dicompdf.sopClassHandler],
      },
    ],
  },
};

/** Las del basic mas la extension del informe (su visor de texto). */
const dependenciasPaciente = {
  ...extensionDependencies,
  '@minipacs/extension-report': '^0.1.0',
};

export const rutaPaciente = {
  ...basicRoute,
  path: 'paciente',
  layoutInstance: layoutPaciente,
};

export const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: 'paciente',
  displayName: 'Paciente',
  toolbarButtons,
  toolbarSections,
  onModeEnter,
  sopClassHandlers: manejadoresPaciente,
  routes: [rutaPaciente],
  extensions: dependenciasPaciente,
};

const mode = {
  ...basicMode,
  id,
  // Oculto en la lista de estudios del OHIF profesional.
  modeInstance: { ...modeInstance, hide: true },
  extensionDependencies: dependenciasPaciente,
};

export default mode;
