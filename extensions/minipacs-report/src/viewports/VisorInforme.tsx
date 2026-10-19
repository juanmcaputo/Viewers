import React, { useEffect, useState } from 'react';
import { leerTID2005, InformeLeido } from '../dicom/leerTID2005';

// Visor de nuestros informes (TID 2005), en castellano.
export default function VisorInforme({ displaySets, extensionManager }) {
  const instancia = displaySets[0]?.instance;
  const [informe, setInforme] = useState<InformeLeido>(() => leerTID2005(instancia));

  // OHIF REUTILIZA este visor al abrir otro informe en el mismo recuadro: solo
  // cambia displaySets. Por eso se vuelve a leer cada vez que cambia la
  // instancia (si no, queda el texto del primer informe abierto).
  // Ademas, si el PACS mando algun texto aparte (texto largo, BulkDataURI), lo
  // trae y lo decodifica como UTF-8.
  useEffect(() => {
    const leido = leerTID2005(instancia);
    setInforme(leido);

    const pendientes = leido.secciones.filter(s => s.bulkDataURI);
    if (!pendientes.length) {
      return;
    }
    // Si se cambia de informe mientras se trae el texto, se descarta
    let vigente = true;
    const [dataSource] = extensionManager.getActiveDataSource();
    Promise.all(
      leido.secciones.map(async s => {
        if (!s.bulkDataURI) {
          return s;
        }
        try {
          const datos = await dataSource.retrieve.bulkDataURI({
            BulkDataURI: s.bulkDataURI,
            StudyInstanceUID: instancia.StudyInstanceUID,
            SeriesInstanceUID: instancia.SeriesInstanceUID,
            SOPInstanceUID: instancia.SOPInstanceUID,
          });
          return { ...s, texto: new TextDecoder('utf-8').decode(datos), bulkDataURI: undefined };
        } catch {
          return { ...s, texto: '(no se pudo cargar el texto del informe)', bulkDataURI: undefined };
        }
      })
    ).then(secciones => {
      if (vigente) {
        setInforme({ ...leido, secciones });
      }
    });
    return () => {
      vigente = false;
    };
  }, [instancia]);

  const estudio = [...informe.modalidades, ...informe.regiones].join(' · ') || '-';

  return (
    <div className="h-full w-full overflow-auto p-6 text-white">
      <div className="border-input flex items-baseline justify-between border-b pb-2">
        <h2 className="text-xl">Informe Especialista</h2>
        <span className="text-muted-foreground text-sm">
          {informe.preliminar ? 'PRELIMINAR' : 'FINAL'} · {informe.firmado ? 'firmado' : 'sin firmar'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Paciente</dt>
        <dd>
          {informe.paciente}
          {informe.pacienteID ? ` (${informe.pacienteID})` : ''}
        </dd>
        <dt className="text-muted-foreground">Fecha</dt>
        <dd>{informe.fecha}</dd>
        <dt className="text-muted-foreground">Médico</dt>
        <dd>{informe.autor}</dd>
        <dt className="text-muted-foreground">Estudio</dt>
        <dd>{estudio}</dd>
      </dl>

      <h3 className="mt-6 text-lg">Informe</h3>
      {informe.secciones.map((s, i) => (
        <div
          key={i}
          className="mt-2"
        >
          {/* con una sola seccion no se repite el titulo; con varias, si */}
          {informe.secciones.length > 1 && <h4 className="font-bold">{s.titulo}</h4>}
          <p className="whitespace-pre-wrap">{s.bulkDataURI ? 'Cargando...' : s.texto}</p>
        </div>
      ))}
    </div>
  );
}
