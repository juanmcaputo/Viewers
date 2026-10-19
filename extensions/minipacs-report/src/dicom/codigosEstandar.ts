// Codigos DICOM estandar (PS3.16). Verificados en dicom.nema.org el 2026-10-19.

export interface Codigo {
  CodeValue: string;
  CodingSchemeDesignator: string;
  CodeMeaning: string;
}

export const codigo = (valor: string, esquema: string, significado: string): Codigo => ({
  CodeValue: valor,
  CodingSchemeDesignator: esquema,
  CodeMeaning: significado,
});

// CID 7000 - titulo del informe
export const TITULO_INFORME = codigo('18748-4', 'LN', 'Diagnostic Imaging Report');

// Conceptos de las filas 2 a 5 de TID 2005
export const PROCEDIMIENTO = codigo('121058', 'DCM', 'Procedure reported');
export const MODALIDAD = codigo('122142', 'DCM', 'Acquisition Device Type');
export const REGION = codigo('123014', 'DCM', 'Target Region');
export const IDIOMA = codigo('121049', 'DCM', 'Language of Content Item and Descendants');
export const ESPANOL = codigo('es', 'RFC5646', 'Spanish');

// CID 7001 (titulo de seccion) y CID 7002 (texto) - filas 6 y 7
export const SECCION_HALLAZGOS = codigo('59776-5', 'LN', 'Findings');
export const TEXTO_HALLAZGO = codigo('121071', 'DCM', 'Finding');

// CID 29 - modalidades (el codigo es el mismo valor de Modality)
export const MODALIDADES: Record<string, string> = {
  BMD: 'Bone Mineral Densitometry',
  CR: 'Computed Radiography',
  CT: 'Computed Tomography',
  DX: 'Digital Radiography',
  MG: 'Mammography',
  MR: 'Magnetic Resonance',
  NM: 'Nuclear Medicine',
  PT: 'Positron emission tomography',
  RF: 'Radiofluoroscopy',
  US: 'Ultrasound',
  XA: 'X-Ray Angiography',
};

// ------------------------------------------------------------------
// Nombres en castellano, SOLO para mostrar (el DICOM guarda los codigos
// estandar con su nombre oficial en ingles).
// ------------------------------------------------------------------

// Por valor de Modality (CID 29)
export const MODALIDADES_ES: Record<string, string> = {
  BMD: 'Densitometría ósea',
  CR: 'Radiografía computada',
  CT: 'Tomografía computada',
  DX: 'Radiografía digital',
  MG: 'Mamografía',
  MR: 'Resonancia magnética',
  NM: 'Medicina nuclear',
  PT: 'PET',
  RF: 'Radiofluoroscopía',
  US: 'Ecografía',
  XA: 'Angiografía',
};

// Por codigo SNOMED CT (los mismos de REGIONES)
export const REGIONES_ES: Record<string, string> = {
  '818981001': 'Abdomen',
  '818982008': 'Abdomen y pelvis',
  '70258002': 'Tobillo',
  '12738006': 'Cerebro',
  '76752008': 'Mama',
  '816094009': 'Tórax',
  '416550000': 'Tórax y abdomen',
  '122494005': 'Columna cervical',
  '16953009': 'Codo',
  '66019005': 'Extremidad',
  '56459004': 'Pie',
  '85562004': 'Mano',
  '69536005': 'Cabeza',
  '80891009': 'Corazón',
  '24136001': 'Cadera',
  '64033007': 'Riñón',
  '72696002': 'Rodilla',
  '10200004': 'Hígado',
  '122496007': 'Columna lumbar',
  '45048000': 'Cuello',
  '816092008': 'Pelvis',
  '16982005': 'Hombro',
  '89546000': 'Cráneo',
  '421060004': 'Columna',
  '69748006': 'Tiroides',
  '122495006': 'Columna dorsal',
  '38266002': 'Cuerpo entero',
  '74670003': 'Muñeca',
};

// Titulos de seccion (CID 7001)
export const SECCIONES_ES: Record<string, string> = {
  '59776-5': 'Hallazgos',
  '19005-8': 'Impresión',
  '55110-1': 'Conclusión',
  '18783-1': 'Recomendaciones',
  '11329-0': 'Antecedentes',
  '55112-7': 'Resumen',
};

// Anexo L - BodyPartExamined (0018,0015) -> region anatomica (SNOMED CT)
export const REGIONES: Record<string, [string, string]> = {
  ABDOMEN: ['818981001', 'Abdomen'],
  ABDOMENPELVIS: ['818982008', 'Abdomen and Pelvis'],
  ANKLE: ['70258002', 'Ankle joint'],
  BRAIN: ['12738006', 'Brain'],
  BREAST: ['76752008', 'Breast'],
  CHEST: ['816094009', 'Chest'],
  CHESTABDOMEN: ['416550000', 'Chest and Abdomen'],
  CSPINE: ['122494005', 'Cervical spine'],
  ELBOW: ['16953009', 'Elbow joint'],
  EXTREMITY: ['66019005', 'Extremity'],
  FOOT: ['56459004', 'Foot'],
  HAND: ['85562004', 'Hand'],
  HEAD: ['69536005', 'Head'],
  HEART: ['80891009', 'Heart'],
  HIP: ['24136001', 'Hip joint'],
  KIDNEY: ['64033007', 'Kidney'],
  KNEE: ['72696002', 'Knee'],
  LIVER: ['10200004', 'Liver'],
  LSPINE: ['122496007', 'Lumbar spine'],
  NECK: ['45048000', 'Neck'],
  PELVIS: ['816092008', 'Pelvis'],
  SHOULDER: ['16982005', 'Shoulder'],
  SKULL: ['89546000', 'Skull'],
  SPINE: ['421060004', 'Spine'],
  THYROID: ['69748006', 'Thyroid'],
  TSPINE: ['122495006', 'Thoracic spine'],
  WHOLEBODY: ['38266002', 'Entire body'],
  WRIST: ['74670003', 'Wrist joint'],
};
