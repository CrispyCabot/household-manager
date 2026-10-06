import type { CreateTaskInput, Recurrence, Task, TaskAuditChange } from './schemas.js';

type AuditedFields = Pick<
  Task,
  | 'title'
  | 'description'
  | 'dueAt'
  | 'recurrence'
  | 'leadTimeDays'
  | 'notifyTimeOfDay'
  | 'renotifyIntervalHours'
  | 'notify'
  | 'assigneeId'
  | 'syncToCalendar'
  | 'calendarId'
  | 'colorId'
>;

function formatRecurrence(r: Recurrence | null): string | null {
  return r === null ? null : `every ${r.every} ${r.unit}${r.every > 1 ? 's' : ''}, from ${r.anchor}`;
}

function formatNotify(n: Task['notify']): string {
  const channels = [n.inApp ? 'in-app' : null, n.email ? 'email' : null].filter((c) => c !== null);
  return channels.length === 0 ? 'none' : channels.join(', ');
}

/** Each audited field's display string, or `null` for "not set". */
const FIELD_FORMATTERS: Record<keyof AuditedFields, (t: AuditedFields) => string | null> = {
  title: (t) => t.title,
  description: (t) => (t.description === '' ? null : t.description),
  dueAt: (t) => t.dueAt.slice(0, 10),
  recurrence: (t) => formatRecurrence(t.recurrence),
  leadTimeDays: (t) => String(t.leadTimeDays),
  notifyTimeOfDay: (t) => t.notifyTimeOfDay,
  renotifyIntervalHours: (t) => (t.renotifyIntervalHours === null ? null : String(t.renotifyIntervalHours)),
  notify: (t) => formatNotify(t.notify),
  assigneeId: (t) => t.assigneeId,
  syncToCalendar: (t) => (t.syncToCalendar ? 'on' : 'off'),
  calendarId: (t) => t.calendarId,
  colorId: (t) => t.colorId,
};

/** The fields of `input` whose value differs from `existing`, as before/after display strings — what the task audit log records for an edit. */
export function diffTaskFields(existing: AuditedFields, input: CreateTaskInput): TaskAuditChange[] {
  const next: AuditedFields = { ...input };
  const changes: TaskAuditChange[] = [];
  for (const field of Object.keys(FIELD_FORMATTERS) as (keyof AuditedFields)[]) {
    const from = FIELD_FORMATTERS[field](existing);
    const to = FIELD_FORMATTERS[field](next);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}
