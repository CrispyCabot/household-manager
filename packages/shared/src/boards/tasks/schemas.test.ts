import { describe, expect, it } from 'vitest';
import { boardType } from '../../boards.js';
import { CreateTaskSchema, TaskSchema, TasksBoardConfigSchema, UpdateTaskSchema } from './schemas.js';
// Side-effect import — registers 'tasks' with the board-type registry, the
// same way the app's registry module does, so `boardType('tasks')` below
// resolves. Without this the registry stays empty and this test would prove
// nothing about what the real app wires up.
import './index.js';

const baseTask = {
  id: 'tsk_1',
  householdId: 'hh_1',
  boardId: 'brd_1',
  title: 'Take out trash',
  description: '',
  dueAt: '2026-01-01T00:00:00.000Z',
  recurrence: null,
  leadTimeDays: 0,
  notifyTimeOfDay: null,
  renotifyIntervalHours: null,
  notify: { inApp: true, email: true },
  status: 'active' as const,
  snoozedUntil: null,
  dismissed: false,
  notifyAfter: null,
  lastCompletedAt: null,
  lastCompletedBy: null,
  syncToCalendar: false,
  calendarId: null,
  colorId: null,
  googleEventId: null,
  googleCalendarId: null,
  syncState: 'ok' as const,
  syncError: null,
  createdBy: 'user_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
};

const baseCreate = {
  title: 'Take out trash',
  dueAt: '2026-01-01T00:00:00.000Z',
};

describe('TaskSchema assigneeId', () => {
  it('accepts null (unassigned)', () => {
    const result = TaskSchema.safeParse({ ...baseTask, assigneeId: null });
    expect(result.success).toBe(true);
  });

  it('accepts a member sub string', () => {
    const result = TaskSchema.safeParse({ ...baseTask, assigneeId: 'user_2' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assigneeId).toBe('user_2');
  });

  it('defaults to null when omitted, for backward compatibility with tasks created before this field existed', () => {
    const { assigneeId: _omit, ...withoutAssignee } = { ...baseTask, assigneeId: null };
    const result = TaskSchema.safeParse(withoutAssignee);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assigneeId).toBeNull();
  });

  it('rejects a non-string, non-null value', () => {
    const result = TaskSchema.safeParse({ ...baseTask, assigneeId: 42 });
    expect(result.success).toBe(false);
  });
});

describe('CreateTaskSchema assigneeId', () => {
  it('defaults to null (unassigned) when omitted', () => {
    const result = CreateTaskSchema.safeParse(baseCreate);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assigneeId).toBeNull();
  });

  it('accepts an explicit member sub', () => {
    const result = CreateTaskSchema.safeParse({ ...baseCreate, assigneeId: 'user_2' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assigneeId).toBe('user_2');
  });

  it('accepts an explicit null', () => {
    const result = CreateTaskSchema.safeParse({ ...baseCreate, assigneeId: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assigneeId).toBeNull();
  });
});

describe('UpdateTaskSchema assigneeId', () => {
  it('inherits the same assigneeId handling as CreateTaskSchema', () => {
    const result = UpdateTaskSchema.safeParse({ ...baseCreate, assigneeId: 'user_3', version: 1 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assigneeId).toBe('user_3');
  });
});

describe('TaskSchema calendar sync (per-task, not board-wide)', () => {
  it('defaults syncToCalendar to false and calendarId to null when omitted', () => {
    const { syncToCalendar: _s, calendarId: _c, ...withoutSync } = baseTask;
    const result = TaskSchema.safeParse(withoutSync);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncToCalendar).toBe(false);
      expect(result.data.calendarId).toBeNull();
    }
  });

  it('accepts sync turned on with a chosen calendar', () => {
    const result = TaskSchema.safeParse({ ...baseTask, syncToCalendar: true, calendarId: 'cal-1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncToCalendar).toBe(true);
      expect(result.data.calendarId).toBe('cal-1');
    }
  });

  it('accepts sync turned on with no calendar chosen yet — a real, surfaced misconfiguration, not a schema-level rejection', () => {
    const result = TaskSchema.safeParse({ ...baseTask, syncToCalendar: true, calendarId: null });
    expect(result.success).toBe(true);
  });
});

describe('CreateTaskSchema calendar sync', () => {
  it('defaults to sync off with no calendar when omitted', () => {
    const result = CreateTaskSchema.safeParse(baseCreate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncToCalendar).toBe(false);
      expect(result.data.calendarId).toBeNull();
    }
  });

  it('accepts an explicit sync-on with a calendar', () => {
    const result = CreateTaskSchema.safeParse({ ...baseCreate, syncToCalendar: true, calendarId: 'cal-2' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncToCalendar).toBe(true);
      expect(result.data.calendarId).toBe('cal-2');
    }
  });
});

describe('TaskSchema colorId', () => {
  it('defaults to null when omitted', () => {
    const { colorId: _omit, ...withoutColor } = baseTask;
    const result = TaskSchema.safeParse(withoutColor);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.colorId).toBeNull();
  });

  it('accepts any of Google\'s 11 fixed event color ids', () => {
    const result = TaskSchema.safeParse({ ...baseTask, colorId: '7' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.colorId).toBe('7');
  });

  it('rejects a value outside Google\'s fixed palette', () => {
    const result = TaskSchema.safeParse({ ...baseTask, colorId: '12' });
    expect(result.success).toBe(false);
  });
});

describe('TasksBoardConfigSchema', () => {
  it('is an empty config — calendar sync moved to per-task fields, not the board', () => {
    expect(TasksBoardConfigSchema.parse({})).toEqual({});
  });

  it('is registered as the "tasks" board type\'s configSchema — what the generic PATCH .../boards/:bid/config route validates against', () => {
    const definition = boardType('tasks');
    expect(definition?.configSchema).toBe(TasksBoardConfigSchema);
  });
});
