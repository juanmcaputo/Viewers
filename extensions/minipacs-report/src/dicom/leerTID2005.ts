// Lee un informe nuestro (Basic Text SR, TID 2005) y lo deja en datos simples
// para mostrarlo. Busca cada dato POR SU CODIGO, no por posicion.
// No depende de OHIF: se puede probar sin navegador.

import { MODALIDADES_ES, REGIONES_ES, SECCIONES_ES } from './codigosEstandar';

export interface SeccionLeida {
  titulo: string;
  texto: string;
  // Si el PACS mando el texto aparte (texto largo), aca va el enlace para traerlo
  bulkDataURI?: string;
}

export interface InformeLeido {
  paciente: string; // "APELLIDO, Nombre"
  pacienteID: string;
  fecha: string; // hora local, ej. "19/10/2026 13:05"
  autor: string;
  preliminar: boolean;
  firmado: boolean;
  modalidades: string[]; // ["Resonancia magnética"]
  regiones: string[]; // ["Abdomen"]
  secciones: SeccionLeida[];
}

// Las secuencias pueden venir como lista o como objeto suelto
const primero = x => (Array.isArray(x) ? x[0] : x);

// ¿Es un informe nuestro? (plantilla DCMR 2005)
export function esInformeTID2005(instancia): boolean {
  const plantilla = primero(instancia?.ContentTemplateSequence);
  return plantilla?.MappingResource === 'DCMR' && String(plantilla?.TemplateIdentifier) === '2005';
}

// Igual que utils.formatPN de OHIF: "APELLIDO^Nombre" -> "APELLIDO, Nombre"
function nombrePersona(valor): string {
  const v = primero(valor);
  const texto = typeof v === 'string' ? v : v?.Alphabetic;
  if (!texto || typeof texto !== 'string') {
    return '';
  }
  return texto.replace('^', ', ').replace(/\^/g, ' ').trim();
}

// ContentDate/ContentTime + TimezoneOffsetFromUTC -> fecha y hora local de la PC
function fechaLocal(fecha?: string, hora?: string, offset?: string): string {
  if (!fecha || fecha.length < 8) {
    return '-';
  }
  const h = (hora ?? '').padEnd(6, '0');
  let ms = Date.UTC(+fecha.slice(0, 4), +fecha.slice(4, 6) - 1, +fecha.slice(6, 8),
    +h.slice(0, 2), +h.slice(2, 4), +h.slice(4, 6));
  // La hora guardada esta en la zona "offset": se pasa a UTC
  const m = /^([+-])(\d{2})(\d{2})$/.exec(offset ?? '');
  if (m) {
    ms -= (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000;
  }
  const d = new Date(ms);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

// TextValue puede venir como texto o, si es largo, como { BulkDataURI }
function textoDe(item): { texto: string; bulkDataURI?: string } {
  const v = primero(item.TextValue);
  if (typeof v === 'string') {
    return { texto: v };
  }
  if (v?.BulkDataURI) {
    return { texto: '', bulkDataURI: v.BulkDataURI };
  }
  return { texto: '' };
}

export function leerTID2005(inst): InformeLeido {
  const informe: InformeLeido = {
    paciente: nombrePersona(inst.PatientName) || '-',
    pacienteID: inst.PatientID ?? '',
    fecha: fechaLocal(inst.ContentDate, inst.ContentTime, inst.TimezoneOffsetFromUTC),
    autor: nombrePersona(primero(inst.AuthorObserverSequence)?.PersonName) || '-',
    preliminar: inst.PreliminaryFlag === 'PRELIMINARY',
    firmado: inst.VerificationFlag === 'VERIFIED',
    modalidades: [],
    regiones: [],
    secciones: [],
  };

  for (const item of inst.ContentSequence ?? []) {
    const concepto = primero(item.ConceptNameCodeSequence);
    const valor = primero(item.ConceptCodeSequence);

    if (concepto?.CodeValue === '122142' && valor) {
      // fila 3: modalidad
      informe.modalidades.push(MODALIDADES_ES[valor.CodeValue] ?? valor.CodeMeaning);
    } else if (concepto?.CodeValue === '123014' && valor) {
      // fila 4: region
      informe.regiones.push(REGIONES_ES[valor.CodeValue] ?? valor.CodeMeaning);
    } else if (item.ValueType === 'CONTAINER') {
      // filas 6 y 7: seccion con su texto
      const titulo = SECCIONES_ES[concepto?.CodeValue] ?? concepto?.CodeMeaning ?? '';
      for (const hijo of item.ContentSequence ?? []) {
        if (hijo.ValueType === 'TEXT') {
          informe.secciones.push({ titulo, ...textoDe(hijo) });
        }
      }
    }
  }

  return informe;
}
