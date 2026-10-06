import { describe, expect, it } from 'vitest';
import { diffTaskFields } from './audit.js';
import type { CreateTaskInput } from './schemas.js';

const base: CreateTaskInput = {
  title: 'Water plants',
  description: '',
  dueAt: '2026-09-20T00:00:00.000Z',
  recurrence: null,
  leadTimeDays: 0,
  notifyTimeOfDay: null,
  renotifyIntervalHours: null,
  notify: { inApp: true, email: true },
  assigneeId: null,
  syncToCalendar: false,
  calendarId: null,
  colorId: null,
};

describe('diffTaskFields', () => {
  it('is empty when nothing changed', () => {
    expect(diffTaskFields(base, { ...base })).toEqual([]);
  });

  it('reports each changed field with before/after display values', () => {
    const changes = diffTaskFields(base, {
      ...base,
      title: 'Water the plants',
      dueAt: '2026-09-25T00:00:00.000Z',
      recurrence: { every: 2, unit: 'week', anchor: 'completion' },
      notify: { inApp: true, email: false },
    });
    expect(changes).toEqual([
      { field: 'title', from: 'Water plants', to: 'Water the plants' },
      { field: 'dueAt', from: '2026-09-20', to: '2026-09-25' },
      { field: 'recurrence', from: null, to: 'every 2 weeks, from completion' },
      { field: 'notify', from: 'in-app, email', to: 'in-app' },
    ]);
  });
});
