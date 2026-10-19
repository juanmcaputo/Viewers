import dcmjs from 'dcmjs';
import {
  Codigo,
  codigo,
  TITULO_INFORME,
  PROCEDIMIENTO,
  MODALIDAD,
  REGION,
  IDIOMA,
  ESPANOL,
  SECCION_HALLAZGOS,
  TEXTO_HALLAZGO,
  MODALIDADES,
} from './codigosEstandar';

const BASIC_TEXT_SR = '1.2.840.10008.5.1.4.1.1.88.11';

export interface ImagenReferencia {
  SeriesInstanceUID: string;
  SOPClassUID: string;
  SOPInstanceUID: string;
}

// Datos que se copian de las imagenes del estudio
export interface DatosEstudio {
  StudyInstanceUID: string;
  PatientID: string;
  IssuerOfPatientID?: string;
  IssuerOfPatientIDQualifiersSequence?: unknown;
  PatientName: unknown; // se copia tal cual viene de OHIF
  PatientBirthDate?: string;
  PatientSex?: string;
  StudyDate?: string;
  StudyTime?: string;
  StudyID?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: unknown;
  procedimientos: Codigo[]; // fila 2: de ProcedureCodeSequence
  modalidades: string[]; // fila 3: US, CT, ...
  regiones: Codigo[]; // fila 4: de AnatomicRegionSequence o BodyPartExamined
  imagenes: ImagenReferencia[];
}

export interface DatosInforme {
  texto: string;
  estudio: DatosEstudio;
  medicoAutor: string; // APELLIDO^NOMBRE
}

// Un item "HAS CONCEPT MOD" de tipo CODE (filas 2 a 5)
const modificador = (concepto: Codigo, valor: Codigo) => ({
  RelationshipType: 'HAS CONCEPT MOD',
  ValueType: 'CODE',
  ConceptNameCodeSequence: [concepto],
  ConceptCodeSequence: [valor],
});

// Todas las imagenes del estudio, agrupadas por serie
function evidencias(estudio: DatosEstudio) {
  const series = new Map<
    string,
    { ReferencedSOPClassUID: string; ReferencedSOPInstanceUID: string }[]
  >();
  for (const img of estudio.imagenes) {
    const refs = series.get(img.SeriesInstanceUID) ?? [];
    refs.push({
      ReferencedSOPClassUID: img.SOPClassUID,
      ReferencedSOPInstanceUID: img.SOPInstanceUID,
    });
    series.set(img.SeriesInstanceUID, refs);
  }
  return [
    {
      StudyInstanceUID: estudio.StudyInstanceUID,
      ReferencedSeriesSequence: [...series].map(([SeriesInstanceUID, ReferencedSOPSequence]) => ({
        SeriesInstanceUID,
        ReferencedSOPSequence,
      })),
    },
  ];
}

export function generarTID2005({ texto, estudio, medicoAutor }: DatosInforme) {
  texto = texto.trim();
  if (!texto) {
    throw new Error('El informe está vacío');
  }
  if (!estudio.StudyInstanceUID || !estudio.PatientID) {
    throw new Error('Faltan datos del estudio');
  }
  if (!medicoAutor?.trim()) {
    throw new Error('Falta identificar al médico autor');
  }
  if (!estudio.imagenes.length) {
    throw new Error('Faltan referencias a las imágenes');
  }

  const ahora = new Date().toISOString(); // fecha y hora UTC
  const fecha = ahora.slice(0, 10).replace(/-/g, '');
  const hora = ahora.slice(11, 19).replace(/:/g, '');
  const SOPInstanceUID = dcmjs.data.DicomMetaDictionary.uid();

  // Contenido segun TID 2005. El ORDEN importa (Order: Significant).
  const contenido = [
    ...estudio.procedimientos.map(p => modificador(PROCEDIMIENTO, p)), // fila 2
    ...estudio.modalidades
      .filter(m => MODALIDADES[m])
      .map(m => modificador(MODALIDAD, codigo(m, 'DCM', MODALIDADES[m]))), // fila 3
    ...estudio.regiones.map(r => modificador(REGION, r)), // fila 4
    modificador(IDIOMA, ESPANOL), // fila 5
    {
      // filas 6 y 7
      RelationshipType: 'CONTAINS',
      ValueType: 'CONTAINER',
      ContinuityOfContent: 'SEPARATE',
      ConceptNameCodeSequence: [SECCION_HALLAZGOS],
      ContentSequence: [
        {
          RelationshipType: 'CONTAINS',
          ValueType: 'TEXT',
          ConceptNameCodeSequence: [TEXTO_HALLAZGO],
          TextValue: texto,
        },
      ],
    },
  ];

  return {
    SpecificCharacterSet: 'ISO_IR 192', // UTF-8: acentos y enies

    // Paciente y estudio: copiados de las imagenes (asi queda en el MISMO estudio)
    PatientID: estudio.PatientID,
    // Emisor del PatientID: tiene que ser el mismo de las imagenes. Si falta,
    // dcm4chee le inventa uno (DCM4CHEE.<hash>), lo toma como otro paciente y
    // rechaza el informe (409: "Patient ID ... differs from Patient ID ...").
    // Si las imagenes no lo traen, no se pone y dcm4chee calcula el mismo.
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

    // El informe: serie 900, una serie nueva por cada guardado
    SOPClassUID: BASIC_TEXT_SR,
    SOPInstanceUID,
    SeriesInstanceUID: dcmjs.data.DicomMetaDictionary.uid(),
    Modality: 'SR',
    SeriesNumber: 900,
    InstanceNumber: 1,
    SeriesDescription: 'Informe Especialista',
    Manufacturer: 'MiniPACS',
    SeriesDate: fecha,
    SeriesTime: hora,
    ContentDate: fecha,
    ContentTime: hora,
    TimezoneOffsetFromUTC: '+0000',

    // Estado: borrador sin firmar (por ahora)
    CompletionFlag: 'COMPLETE',
    VerificationFlag: 'UNVERIFIED',
    PreliminaryFlag: 'PRELIMINARY',

    // TID 2005 exige autor o verificador
    AuthorObserverSequence: [
      {
        ObserverType: 'PSN',
        PersonName: { Alphabetic: medicoAutor },
        PersonIdentificationCodeSequence: [],
      },
    ],

    ReferencedPerformedProcedureStepSequence: [],
    PerformedProcedureCodeSequence: [],
    CurrentRequestedProcedureEvidenceSequence: evidencias(estudio),

    // Raiz del arbol (fila 1)
    ValueType: 'CONTAINER',
    ContinuityOfContent: 'SEPARATE',
    ConceptNameCodeSequence: [TITULO_INFORME],
    ContentTemplateSequence: [{ MappingResource: 'DCMR', TemplateIdentifier: '2005' }],
    ContentSequence: contenido,

    // OHIF arma el resto de la cabecera del archivo; de aca solo lee esto,
    // y en este formato (extensions/default/src/DicomWebDataSource/index.ts)
    _meta: {
      FileMetaInformationVersion: { Value: [new Uint8Array([0, 1]).buffer], vr: 'OB' },
    },
  };
}
