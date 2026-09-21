import { describe, expect, it } from 'vitest';
import { CreateTaskSchema, TaskSchema, UpdateTaskSchema } from './schemas.js';

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
  syncToCalendar: null,
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
