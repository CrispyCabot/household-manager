import { registerBoardType } from '../../boards.js';
import { TasksBoardConfigSchema } from './schemas.js';

export * from './schemas.js';
export * from './recurrence.js';

// Side effect, at module load: this is the one place "tasks" becomes a real
// board type. The core (households, generic boards) never imports this
// module — only this file's own presence in the app's dependency graph
// (via packages/shared/src/index.ts, and the app-side registry module in
// Task 4) is what activates it.
registerBoardType({
  id: 'tasks',
  displayName: 'Tasks',
  icon: '✅',
  configSchema: TasksBoardConfigSchema,
});
