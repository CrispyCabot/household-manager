import { z } from 'zod';
import { registerBoardType } from '../../boards.js';

export * from './schemas.js';

// Side effect, at module load — mirrors boards/tasks/index.ts.
registerBoardType({
  id: 'text',
  displayName: 'Text Entry',
  icon: '📝',
  configSchema: z.object({}),
});
