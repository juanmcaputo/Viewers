import React, { useState } from 'react';
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@ohif/ui-next';

// Largo maximo del informe (el contador de abajo a la derecha).
const MAX_CARACTERES = 10000;

export default function ReportPanel({ reportService }) {

  // Texto que escribe el médico
  const [texto, setTexto] = useState('');

  // Mientras se envia: bloquea el panel (evita el doble clic)
  const [enviando, setEnviando] = useState(false);

  // Resultado del ultimo envio
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // Cancelar: borra el texto del cuadro.
  const cancelar = () => {
    setTexto('');
    setMensaje(null);
  };

  // Guardar y enviar: arma el DICOM SR (TID 2005) y lo manda al PACS.
  const guardarYEnviar = async () => {
    setEnviando(true);
    setMensaje(null);
    try {
      await reportService.guardarInforme(texto);
      setTexto('');
      setMensaje({ tipo: 'ok', texto: 'Informe enviado al PACS.' });
    } catch (error) {
      setMensaje({ tipo: 'error', texto: error?.message || 'No se pudo enviar el informe.' });
    } finally {
      setEnviando(false);
    }
  };

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
            disabled={enviando}
            placeholder="Escriba el informe aquí..."
            className="border-input text-foreground bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[250px] w-full flex-1 resize-none rounded border p-3 pb-7 text-base focus-visible:outline-none focus-visible:ring-1 disabled:opacity-50"
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
          disabled={enviando}
        >
          Cancelar
        </Button>
        <Button
          variant="default"
          onClick={guardarYEnviar}
          disabled={enviando || !texto.trim()}
        >
          {enviando ? 'Enviando...' : 'Guardar y enviar'}
        </Button>
      </div>

      {mensaje && (
        <p className={mensaje.tipo === 'ok' ? 'text-sm text-green-500' : 'text-sm text-red-500'}>
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
