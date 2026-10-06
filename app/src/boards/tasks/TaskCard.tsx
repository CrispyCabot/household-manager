import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatNextNotified, formatRenotifyInterval } from '@hhm/shared';
import type { Task } from '@hhm/shared';
import { useCompleteTask, useDeleteTask, useMembers, useUncompleteTask } from '../../api/queries.js';
import { TaskForm } from './TaskForm.js';

const UNDO_WINDOW_MS = 24 * 3_600_000;

export function taskPath(householdId: string, task: Pick<Task, 'boardId' | 'id'>): string {
  return `/households/${householdId}/boards/${task.boardId}/tasks/${task.id}`;
}

/** A task's title, description and summary line. Shared by the board's row and the task's own page; `expanded` adds the less-glanceable settings (the page shows them, the row doesn't). */
export function TaskDetails({
  householdId,
  task,
  linkTitle = false,
  expanded = false,
}: {
  householdId: string;
  task: Task;
  linkTitle?: boolean;
  expanded?: boolean;
}) {
  // Shares the same query/cache key as the assignee picker in TaskForm, so
  // rendering every row's assignee costs one fetch per board view, not one
  // per row.
  const { data: membersData } = useMembers(householdId);
  const emailOf = (sub: string | null) => membersData?.members.find((m) => m.sub === sub)?.email ?? null;
  const assigneeEmail = emailOf(task.assigneeId);

  return (
    <div>
      {linkTitle ? (
        <Link to={taskPath(householdId, task)} className="task-row__title">
          <strong>{task.title}</strong>
        </Link>
      ) : (
        <strong>{task.title}</strong>
      )}
      {task.description !== '' && <p className="task-row__desc">{task.description}</p>}
      <span className="task-row__due"> Due {new Date(task.dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}</span>
      {task.recurrence !== null && (
        <span className="task-row__recur">
          {' '}
          · every {task.recurrence.every} {task.recurrence.unit}
          {task.recurrence.every > 1 ? 's' : ''}
        </span>
      )}
      {task.renotifyIntervalHours !== null && (
        <span className="task-row__recur"> · reminds every {formatRenotifyInterval(task.renotifyIntervalHours)}</span>
      )}
      {assigneeEmail !== null && <span className="task-row__assignee"> · assigned to {assigneeEmail}</span>}
      {task.snoozedUntil !== null && new Date(task.snoozedUntil).getTime() > Date.now() && (
        <span className="task-row__recur"> · Snoozed until {formatNextNotified(new Date(task.snoozedUntil).getTime())}</span>
      )}
      {task.syncState === 'error' && (
        <span className="task-row__desc" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={14} />
          {task.syncError ?? 'Calendar sync failed.'}
        </span>
      )}
      {expanded && (
        <ul className="task-row__facts">
          <li>Status: {task.status === 'completed' ? 'Completed' : 'Active'}</li>
          {task.recurrence !== null && (
            <li>Repeats from {task.recurrence.anchor === 'completion' ? 'the day it is completed' : 'its original due date'}</li>
          )}
          <li>Notifications start {task.leadTimeDays} day{task.leadTimeDays === 1 ? '' : 's'} before it is due{task.notifyTimeOfDay !== null ? ` at ${task.notifyTimeOfDay}` : ''}</li>
          <li>Notify via {[task.notify.inApp ? 'in-app' : null, task.notify.email ? 'email' : null].filter((c) => c !== null).join(' and ') || 'nothing'}</li>
          {task.dismissed && <li>Reminder emails are stopped (dismissed)</li>}
          {task.syncToCalendar && <li>Synced to Google Calendar</li>}
          {task.lastCompletedAt !== null && (
            <li>
              Last completed {new Date(task.lastCompletedAt).toLocaleString()}
              {emailOf(task.lastCompletedBy) !== null ? ` by ${emailOf(task.lastCompletedBy)}` : ''}
            </li>
          )}
          <li>
            Created {new Date(task.createdAt).toLocaleString()}
            {emailOf(task.createdBy) !== null ? ` by ${emailOf(task.createdBy)}` : ''}
          </li>
        </ul>
      )}
    </div>
  );
}

/** Complete / undo / edit / delete — the same buttons on the board row and on the task's own page. */
export function TaskActions({
  householdId,
  task,
  onEdit,
  onDeleted,
}: {
  householdId: string;
  task: Task;
  onEdit: () => void;
  onDeleted?: () => void;
}) {
  const complete = useCompleteTask(householdId, task.boardId);
  const uncomplete = useUncompleteTask(householdId, task.boardId);
  const remove = useDeleteTask(householdId, task.boardId);

  const isCompleted = task.status === 'completed';
  // A completed one-off can always be reopened. A recurring task never reads
  // as "completed" (it just rolls to its next due date), so the undo for it
  // is only offered briefly after the completion — long enough to fix a
  // mis-tap, without showing the button on every recurring row forever.
  const completedRecently =
    task.lastCompletedAt !== null && Date.now() - new Date(task.lastCompletedAt).getTime() < UNDO_WINDOW_MS;
  const canUndo = isCompleted || completedRecently;

  return (
    <div className="task-row__actions">
      {!isCompleted && (
        <button type="button" className="btn-primary" onClick={() => complete.mutate(task.id)} disabled={complete.isPending}>
          Complete
        </button>
      )}
      {canUndo && (
        <button type="button" className="btn-small" onClick={() => uncomplete.mutate(task.id)} disabled={uncomplete.isPending}>
          {isCompleted ? 'Mark not done' : 'Undo completion'}
        </button>
      )}
      <button type="button" className="btn-small" onClick={onEdit}>
        Edit
      </button>
      <button
        type="button"
        className="btn-danger"
        onClick={() => remove.mutate(task.id, onDeleted === undefined ? {} : { onSuccess: onDeleted })}
        disabled={remove.isPending}
      >
        Delete
      </button>
    </div>
  );
}

export function TaskRow({ householdId, task }: { householdId: string; task: Task }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <TaskForm
        householdId={householdId}
        boardId={task.boardId}
        task={task}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className={task.status === 'completed' ? 'task-row task-row--completed' : 'task-row'}>
      <TaskDetails householdId={householdId} task={task} linkTitle />
      <TaskActions householdId={householdId} task={task} onEdit={() => setEditing(true)} />
    </div>
  );
}
