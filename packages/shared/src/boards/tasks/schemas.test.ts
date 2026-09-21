import { describe, expect, it } from 'vitest';
import { boardType } from '../../boards.js';
import { TasksBoardConfigSchema } from './schemas.js';
// Side-effect import — registers 'tasks' with the board-type registry, the
// same way the app's registry module does, so `boardType('tasks')` below
// resolves. Without this the registry stays empty and this test would prove
// nothing about what the real app wires up.
import './index.js';

describe('TasksBoardConfigSchema', () => {
  it('defaults googleSync to disabled with no calendar selected', () => {
    expect(TasksBoardConfigSchema.parse({})).toEqual({ googleSync: { enabled: false, calendarId: null } });
  });

  it('accepts an enabled sync with a chosen calendar — what the tasks-board settings panel saves', () => {
    const parsed = TasksBoardConfigSchema.parse({ googleSync: { enabled: true, calendarId: 'cal-1' } });
    expect(parsed.googleSync).toEqual({ enabled: true, calendarId: 'cal-1' });
  });

  it('is registered as the "tasks" board type\'s configSchema — what the generic PATCH .../boards/:bid/config route validates against, so no route change is needed to accept googleSync', () => {
    const definition = boardType('tasks');
    expect(definition?.configSchema).toBe(TasksBoardConfigSchema);
    expect(definition?.configSchema.safeParse({ googleSync: { enabled: true, calendarId: 'cal-1' } }).success).toBe(true);
  });
});
