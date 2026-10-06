import { formatDurationHours, formatRenotifyInterval } from '@hhm/shared';
import type { TaskAuditChange, TaskAuditEntry } from '@hhm/shared';
import { useMembers, useTaskAudit } from '../../api/queries.js';
import { Loading } from '../../components/Loading.js';

const FIELD_LABELS: Record<string, string> = {
  title: 'the title',
  description: 'the description',
  dueAt: 'the due date',
  recurrence: 'the recurrence',
  leadTimeDays: 'the notification lead time',
  notifyTimeOfDay: 'the notification time',
  renotifyIntervalHours: 'the reminder frequency',
  notify: 'the notification channels',
  assigneeId: 'the assignee',
  syncToCalendar: 'calendar sync',
  calendarId: 'the calendar',
  colorId: 'the calendar color',
};

function describeActor(actor: string, emailOf: (sub: string) => string | undefined): string {
  if (actor === 'email-action') return 'An email link';
  if (actor.startsWith('device:')) return 'A wall display';
  return emailOf(actor) ?? 'A former member';
}

function formatValue(change: TaskAuditChange, which: 'from' | 'to', emailOf: (sub: string) => string | undefined): string {
  const value = change[which];
  if (value === null) return change.field === 'assigneeId' ? 'unassigned' : 'not set';
  if (change.field === 'assigneeId') return emailOf(value) ?? 'a former member';
  if (change.field === 'renotifyIntervalHours') return `every ${formatRenotifyInterval(Number(value))}`;
  if (change.field === 'leadTimeDays') return `${value} day${value === '1' ? '' : 's'}`;
  return value === '' ? 'empty' : value;
}

function describeAction(entry: TaskAuditEntry): string {
  switch (entry.action) {
    case 'created':
      return 'created the task';
    case 'completed':
      return 'marked it complete';
    case 'uncompleted':
      return 'marked it not done';
    case 'snoozed':
      return `snoozed it for ${formatDurationHours(entry.hours ?? 0)}`;
    case 'snooze_cleared':
      return 'cleared the snooze';
    case 'dismissed':
      return 'dismissed it (stopped reminder emails)';
    case 'updated':
      return 'edited it';
  }
}

/** Every action taken on a task and by whom, newest first. Used only on the task's own page. */
export function TaskAudit({ householdId, boardId, taskId }: { householdId: string; boardId: string; taskId: string }) {
  const { data, isLoading } = useTaskAudit(householdId, boardId, taskId);
  const { data: membersData } = useMembers(householdId);
  const emailOf = (sub: string) => membersData?.members.find((m) => m.sub === sub)?.email;

  return (
    <section className="task-audit">
      <h2>Task Audit</h2>
      {isLoading && <Loading />}
      {!isLoading && (data?.entries.length ?? 0) === 0 && <p className="notice">No activity recorded yet.</p>}
      <ul className="task-audit__list">
        {(data?.entries ?? []).map((entry) => (
          <li key={entry.id} className="task-audit__entry">
            <div>
              <strong>{describeActor(entry.actor, emailOf)}</strong> {describeAction(entry)}
            </div>
            {entry.changes.length > 0 && (
              <ul className="task-audit__changes">
                {entry.changes.map((change) => (
                  <li key={change.field}>
                    Changed {FIELD_LABELS[change.field] ?? change.field} from "{formatValue(change, 'from', emailOf)}" to "
                    {formatValue(change, 'to', emailOf)}"
                  </li>
                ))}
              </ul>
            )}
            <time className="task-audit__time" dateTime={entry.at}>
              {new Date(entry.at).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
