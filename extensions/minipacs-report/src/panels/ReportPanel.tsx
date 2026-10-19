import React, { useState } from 'react';
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@ohif/ui-next';

// Largo maximo del informe (el contador de abajo a la derecha).
const MAX_CARACTERES = 10000;

export default function ReportPanel() {

  // Texto que escribe el médico
  const [texto, setTexto] = useState('');

  // Cancelar: borra el texto del cuadro.
  const cancelar = () => {
    setTexto('');
  };

  // Guardar y enviar: todavia no hace nada.
  // Aca va despues el armado del DICOM SR y el envio al PACS.
  const guardarYEnviar = () => {};

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h3 className="text-foreground text-lg">Informe médico</h3>

      <Tabs
        defaultValue="texto-libre"
        className="flex flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="texto-libre">Texto libre</TabsTrigger>
        </TabsList>

        <TabsContent
          value="texto-libre"
          className="relative mt-3 flex flex-1 flex-col"
        >
          <textarea
            id="textoInforme"
            value={texto}
            onChange={e => setTexto(e.target.value)}
            maxLength={MAX_CARACTERES}
            placeholder="Escriba el informe aquí..."
            className="border-input text-foreground bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[250px] w-full flex-1 resize-none rounded border p-3 pb-7 text-base focus-visible:outline-none focus-visible:ring-1"
          />
          <span className="text-muted-foreground pointer-events-none absolute bottom-2 right-3 text-sm">
            {texto.length}/{MAX_CARACTERES}
          </span>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={cancelar}
        >
          Cancelar
        </Button>
        <Button
          variant="default"
          onClick={guardarYEnviar}
          disabled={!texto.trim()}
        >
          Guardar y enviar
        </Button>
      </div>
    </div>
  );
}
