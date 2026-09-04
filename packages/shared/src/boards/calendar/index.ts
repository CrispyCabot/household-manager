import { registerBoardType } from '../../boards.js';
import { CalendarBoardConfigSchema } from './schemas.js';

export * from './schemas.js';

// Side effect, at module load — same pattern as boards/tasks/index.ts.
registerBoardType({
  id: 'calendar',
  displayName: 'Calendar',
  icon: '📅',
  configSchema: CalendarBoardConfigSchema,
});
