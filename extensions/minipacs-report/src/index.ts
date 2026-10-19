import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';
import getViewportModule from './getViewportModule';

const id = '@minipacs/extension-report';
const version = '0.1.0';

export default {
  id,
  version,
  getPanelModule,
  getCommandsModule,
  getSopClassHandlerModule,
  getViewportModule,
};
