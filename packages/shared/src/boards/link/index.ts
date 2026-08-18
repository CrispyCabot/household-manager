import { z } from 'zod';
import { registerBoardType } from '../../boards.js';

export * from './schemas.js';

// Side effect, at module load — mirrors boards/text/index.ts.
registerBoardType({
  id: 'link',
  displayName: 'Link',
  icon: '🔗',
  configSchema: z.object({}),
});
