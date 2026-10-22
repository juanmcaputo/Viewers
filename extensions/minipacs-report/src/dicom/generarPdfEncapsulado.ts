import dcmjs from 'dcmjs';
import { DatosEstudio } from './generarTID2005';

// Encapsulated PDF Storage (PS3.3 A.45.1): un PDF guardado como instancia DICOM.
// Se cuelga del estudio abierto como una serie nueva, modalidad DOC (serie 902),
// asi aparece junto a las imagenes y al informe, y OHIF lo muestra con su visor de PDF.
const ENCAPSULATED_PDF = '1.2.840.10008.5.1.4.1.1.104.1';
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// Devuelve el dataset NATURALIZADO (el mismo formato que generarTID2005), listo
// para enviar por STOW-RS
export async function generarPdfEncapsulado(
  archivo: File,
  estudio: DatosEstudio,
  titulo?: string
) {
  if (archivo.size > MAX_BYTES) {
    throw new Error('El PDF supera los 50 MB');
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const cabecera = String.fromCharCode(...bytes.slice(0, 5));
  if (cabecera !== '%PDF-') {
    throw new Error('El archivo no es un PDF válido');
  }
  if (!estudio.StudyInstanceUID || !estudio.PatientID) {
    throw new Error('Faltan datos del estudio');
  }

  // DICOM exige largo par: se agrega un byte 0 si el PDF es impar
  const relleno = new Uint8Array(bytes.length + (bytes.length % 2));
  relleno.set(bytes);

  const ahora = new Date().toISOString(); // fecha y hora UTC
  const fecha = ahora.slice(0, 10).replace(/-/g, '');
  const hora = ahora.slice(11, 19).replace(/:/g, '');
  const sinExtension = archivo.name.replace(/\.[^.]*$/, '');

  return {
    SpecificCharacterSet: 'ISO_IR 192', // UTF-8: acentos y enies

    // Paciente y estudio: copiados de las imagenes (asi queda en el MISMO estudio)
    PatientID: estudio.PatientID,
    // Emisor del PatientID: igual que en generarTID2005 (si falta, dcm4chee responde 409)
    ...(estudio.IssuerOfPatientID && { IssuerOfPatientID: estudio.IssuerOfPatientID }),
    ...(estudio.IssuerOfPatientIDQualifiersSequence && {
      IssuerOfPatientIDQualifiersSequence: estudio.IssuerOfPatientIDQualifiersSequence,
    }),
    PatientName: estudio.PatientName,
    PatientBirthDate: estudio.PatientBirthDate ?? '',
    PatientSex: estudio.PatientSex ?? '',
    StudyInstanceUID: estudio.StudyInstanceUID,
    StudyDate: estudio.StudyDate ?? '',
    StudyTime: estudio.StudyTime ?? '',
    StudyID: estudio.StudyID ?? '',
    AccessionNumber: estudio.AccessionNumber ?? '',
    ReferringPhysicianName: estudio.ReferringPhysicianName ?? '',

    // El PDF: serie 902, una serie nueva por cada archivo adjuntado
    SOPClassUID: ENCAPSULATED_PDF,
    SOPInstanceUID: dcmjs.data.DicomMetaDictionary.uid(),
    SeriesInstanceUID: dcmjs.data.DicomMetaDictionary.uid(),
    Modality: 'DOC',
    SeriesNumber: 902,
    InstanceNumber: 1,
    SeriesDescription: 'Informe PDF',
    Manufacturer: 'MiniPACS',
    SeriesDate: fecha,
    SeriesTime: hora,
    ContentDate: fecha,
    ContentTime: hora,
    AcquisitionDateTime: `${fecha}${hora}`,
    TimezoneOffsetFromUTC: '+0000',

    ConversionType: 'WSD', // documento digitalizado desde una estacion de trabajo
    BurnedInAnnotation: 'YES',
    DocumentTitle: titulo?.trim() || sinExtension,
    ConceptNameCodeSequence: [
      {
        CodeValue: '18748-4',
        CodingSchemeDesignator: 'LN',
        CodeMeaning: 'Diagnostic imaging study',
      },
    ],

    MIMETypeOfEncapsulatedDocument: 'application/pdf',
    EncapsulatedDocumentLength: bytes.length, // sin el byte de relleno
    EncapsulatedDocument: [relleno.buffer],

    // Igual que generarTID2005: OHIF arma el resto de la cabecera del archivo
    _meta: {
      FileMetaInformationVersion: { Value: [new Uint8Array([0, 1]).buffer], vr: 'OB' },
    },
  };
}
