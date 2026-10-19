import React from 'react';
import ReportPanel from './panels/ReportPanel';

export default function getPanelModule({
  servicesManager,
  commandsManager,
}) {

  return [
    {
      name: 'report',
      iconName: 'clipboard',
      label: 'Informe médico',

      component: () => (
        <ReportPanel />
      ),
    },
  ];
}
