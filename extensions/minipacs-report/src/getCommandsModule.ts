export default function getCommandsModule({
  servicesManager,
}) {
  const { panelService } = servicesManager.services;

  return {
    defaultContext: 'DEFAULT',

    definitions: {
      openReport: {
        commandFn: () => {
          panelService.activatePanel(
            '@minipacs/extension-report.panelModule.report',
            true
          );
        },
      },
    },
  };
}
