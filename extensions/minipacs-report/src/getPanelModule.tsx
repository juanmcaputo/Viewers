import React from 'react';
import ReportPanel from './panels/ReportPanel';
import { ReportService } from './services/ReportService';

export default function getPanelModule({ servicesManager, extensionManager }) {
  const reportService = new ReportService(servicesManager, extensionManager);

  return [
    {
      name: 'report',
      iconName: 'clipboard',
      label: 'Informe médico',

      component: () => <ReportPanel reportService={reportService} />,
    },
  ];
}
