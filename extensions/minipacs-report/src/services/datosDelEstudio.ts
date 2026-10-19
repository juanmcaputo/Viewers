import { DicomMetadataStore } from '@ohif/core';
import { Codigo, codigo, REGIONES } from '../dicom/codigosEstandar';
import { DatosEstudio } from '../dicom/generarTID2005';

// Series que NO son imagenes: no van como evidencia (si no, cada informe
// citaria a los informes anteriores)
const NO_IMAGENES = ['SR', 'KO', 'PR', 'SEG', 'RTSTRUCT'];

// Que estudio esta abierto en el visor (el del visor activo)
export function estudioActivo(servicesManager): string {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const viewportId = viewportGridService.getActiveViewportId();
  const [uid] = viewportGridService.getDisplaySetsUIDsForViewport(viewportId) ?? [];
  const displaySet = uid ? displaySetService.getDisplaySetByUID(uid) : null;
  if (!displaySet?.StudyInstanceUID) {
    throw new Error('No hay un estudio abierto en el visor');
  }
  return displaySet.StudyInstanceUID;
}

// Region: la ya codificada en la imagen, o traducida con el Anexo L
function regiones(instancia): Codigo[] {
  if (instancia.AnatomicRegionSequence?.length) {
    return instancia.AnatomicRegionSequence.map(r =>
      codigo(r.CodeValue, r.CodingSchemeDesignator, r.CodeMeaning)
    );
  }
  const r = REGIONES[String(instancia.BodyPartExamined ?? '').toUpperCase()];
  return r ? [codigo(r[0], 'SCT', r[1])] : [];
}

export function datosDelEstudio(StudyInstanceUID: string): DatosEstudio {
  const estudio = DicomMetadataStore.getStudy(StudyInstanceUID);
  const series = (estudio?.series ?? []).filter(
    s => s.instances.length && !NO_IMAGENES.includes(s.instances[0].Modality)
  );
  const instancias = series.flatMap(s => s.instances);
  const primera = instancias[0];
  if (!primera) {
    throw new Error('El estudio no tiene imágenes cargadas');
  }

  return {
    StudyInstanceUID,
    PatientID: primera.PatientID,
    IssuerOfPatientID: primera.IssuerOfPatientID,
    IssuerOfPatientIDQualifiersSequence: primera.IssuerOfPatientIDQualifiersSequence,
    PatientName: primera.PatientName,
    PatientBirthDate: primera.PatientBirthDate,
    PatientSex: primera.PatientSex,
    StudyDate: primera.StudyDate,
    StudyTime: primera.StudyTime,
    StudyID: primera.StudyID,
    AccessionNumber: primera.AccessionNumber,
    ReferringPhysicianName: primera.ReferringPhysicianName,
    procedimientos: (primera.ProcedureCodeSequence ?? []).map(p =>
      codigo(p.CodeValue, p.CodingSchemeDesignator, p.CodeMeaning)
    ),
    modalidades: [...new Set<string>(series.map(s => s.instances[0].Modality))],
    regiones: regiones(primera),
    imagenes: instancias.map(i => ({
      SeriesInstanceUID: i.SeriesInstanceUID,
      SOPClassUID: i.SOPClassUID,
      SOPInstanceUID: i.SOPInstanceUID,
    })),
  };
}
