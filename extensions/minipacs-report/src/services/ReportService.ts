import dcmjs from 'dcmjs';
import { DicomMetadataStore } from '@ohif/core';
import { generarTID2005 } from '../dicom/generarTID2005';
import { estudioActivo, datosDelEstudio } from './datosDelEstudio';

const { naturalizeDataset, denaturalizeDataset } = dcmjs.data.DicomMetaDictionary;

export class ReportService {
  constructor(
    private servicesManager,
    private extensionManager
  ) {}

  async guardarInforme(texto: string): Promise<string> {
    const StudyInstanceUID = estudioActivo(this.servicesManager);
    const dataset = generarTID2005({
      texto,
      estudio: datosDelEstudio(StudyInstanceUID),
      medicoAutor: this.medicoAutor(),
    });

    const [dataSource] = this.extensionManager.getActiveDataSource();
    await dataSource.store.dicom(dataset); // STOW-RS a dcm4chee

    // Que OHIF se entere sin recargar (igual que storeMeasurements de OHIF).
    // OHIF espera el formato que produce dcmjs al leer del PACS (secuencias con
    // atajos, ej. seq.CodeMeaning): sin esto los nombres de los items salen vacios.
    dataSource.deleteStudyMetadataPromise(StudyInstanceUID);
    const { _meta, ...sinMeta } = dataset;
    DicomMetadataStore.addInstances([naturalizeDataset(denaturalizeDataset(sinMeta))], true);

    return dataset.SOPInstanceUID;
  }

  // El usuario logueado en Keycloak (lo guarda OHIF al iniciar sesion)
  private medicoAutor(): string {
    const perfil = this.servicesManager.services.userAuthenticationService.getUser()?.profile;
    if (perfil?.family_name) {
      return `${perfil.family_name}^${perfil.given_name ?? ''}`;
    }
    const nombre = perfil?.name ?? perfil?.preferred_username;
    if (!nombre) {
      throw new Error('No se pudo identificar al médico: volvé a iniciar sesión');
    }
    return nombre;
  }
}
