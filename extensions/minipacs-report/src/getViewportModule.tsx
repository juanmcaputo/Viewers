import React from 'react';
import VisorInforme from './viewports/VisorInforme';

// Registra el visor de nuestros informes. En el modo se asocia al manejador
// informe-tid2005 (modesConfiguration, displaySetsToDisplay).
export default function getViewportModule({ servicesManager, extensionManager }) {
  const Visor = props => (
    <VisorInforme
      servicesManager={servicesManager}
      extensionManager={extensionManager}
      {...props}
    />
  );

  return [{ name: 'informe-tid2005', component: Visor }];
}
