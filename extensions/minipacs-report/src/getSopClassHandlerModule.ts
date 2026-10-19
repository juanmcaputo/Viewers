import { utils } from '@ohif/core';
import { esInformeTID2005 } from './dicom/leerTID2005';

const BASIC_TEXT_SR = '1.2.840.10008.5.1.4.1.1.88.11';
const ID = '@minipacs/extension-report.sopClassHandlerModule.informe-tid2005';

// Manejador de nuestros informes. En el modo va PRIMERO (modesConfiguration):
// toma solo los Basic Text SR con plantilla TID 2005; cualquier otro SR sigue
// de largo al manejador de SR de OHIF.
export default function getSopClassHandlerModule() {
  return [
    {
      name: 'informe-tid2005',
      sopClassUids: [BASIC_TEXT_SR],
      getDisplaySetsFromSeries: instances =>
        instances.filter(esInformeTID2005).map(instance => ({
          displaySetInstanceUID: utils.guid(),
          SOPClassHandlerId: ID,
          SOPClassUID: instance.SOPClassUID,
          SOPInstanceUID: instance.SOPInstanceUID,
          SeriesInstanceUID: instance.SeriesInstanceUID,
          StudyInstanceUID: instance.StudyInstanceUID,
          Modality: 'SR',
          SeriesDescription: instance.SeriesDescription,
          SeriesNumber: instance.SeriesNumber,
          SeriesDate: instance.SeriesDate,
          label: instance.SeriesDescription || 'Informe',
          instance,
          instances: [instance],
          numImageFrames: 0,
          numInstances: 1,
          isDerivedDisplaySet: true,
          isLoaded: true,
          thumbnailSrc: null,
          sopClassUids: [BASIC_TEXT_SR],
        })),
    },
  ];
}
