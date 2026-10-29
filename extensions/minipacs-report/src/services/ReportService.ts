import dcmjs from 'dcmjs';
import { DicomMetadataStore } from '@ohif/core';
import { generarTID2005 } from '../dicom/generarTID2005';
import { generarPdfEncapsulado } from '../dicom/generarPdfEncapsulado';
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
      medicoAutor: await this.medicoAutor(),
    });

    await this.enviarYRefrescar(dataset, StudyInstanceUID);
    return dataset.SOPInstanceUID;
  }

  // Adjuntar PDF: lo guarda como DICOM Encapsulated PDF en el estudio abierto
  async adjuntarPdf(archivo: File, titulo?: string): Promise<string> {
    const StudyInstanceUID = estudioActivo(this.servicesManager);
    const dataset = await generarPdfEncapsulado(
      archivo,
      datosDelEstudio(StudyInstanceUID),
      titulo
    );
    await this.enviarYRefrescar(dataset, StudyInstanceUID);
    return dataset.SOPInstanceUID;
  }

  // Envia el dataset al PACS y actualiza el estudio en OHIF
  private async enviarYRefrescar(dataset, StudyInstanceUID: string): Promise<void> {
    const [dataSource] = this.extensionManager.getActiveDataSource();
    await dataSource.store.dicom(dataset); // STOW-RS a dcm4chee

    // Que OHIF se entere sin recargar (igual que storeMeasurements de OHIF).
    // OHIF espera el formato que produce dcmjs al leer del PACS (secuencias con
    // atajos, ej. seq.CodeMeaning): sin esto los nombres de los items salen vacios.
    dataSource.deleteStudyMetadataPromise(StudyInstanceUID);
    const { _meta, ...sinMeta } = dataset;
    DicomMetadataStore.addInstances([naturalizeDataset(denaturalizeDataset(sinMeta))], true);
  }

  // El medico: el usuario logueado en Keycloak (lo guarda OHIF al iniciar sesion) o, si entro desde el
  // portal por el servicio de pase (sin Keycloak), el nombre que da GET /pase/yo (SERVICIO_PASE.md, seccion 3)
  private async medicoAutor(): Promise<string> {
    const perfil = this.servicesManager.services.userAuthenticationService.getUser()?.profile;
    if (perfil?.family_name) {
      return `${perfil.family_name}^${perfil.given_name ?? ''}`;
    }
    const nombre = perfil?.name ?? perfil?.preferred_username;
    if (nombre) {
      return nombre;
    }
    const respuesta = await fetch('/pase/yo', { credentials: 'same-origin' });
    if (respuesta.ok) {
      const { nombre: dado, apellido } = await respuesta.json();
      if (apellido) {
        return `${apellido}^${dado ?? ''}`;
      }
    }
    throw new Error('No se pudo identificar al médico: volvé a iniciar sesión');
  }
}
