import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { formatNextNotified, formatRenotifyInterval } from '@hhm/shared';
import type { Task } from '@hhm/shared';
import { useCompleteTask, useDeleteTask, useMembers, useUncompleteTask } from '../../api/queries.js';
import { TaskForm } from './TaskForm.js';

const UNDO_WINDOW_MS = 24 * 3_600_000;

export function TaskRow({ householdId, task }: { householdId: string; task: Task }) {
  const [editing, setEditing] = useState(false);
  const complete = useCompleteTask(householdId, task.boardId);
  const uncomplete = useUncompleteTask(householdId, task.boardId);
  const remove = useDeleteTask(householdId, task.boardId);
  // Shares the same query/cache key as the assignee picker in TaskForm, so
  // rendering every row's assignee costs one fetch per board view, not one
  // per row.
  const { data: membersData } = useMembers(householdId);
  const assigneeEmail = membersData?.members.find((m) => m.sub === task.assigneeId)?.email ?? null;

  const isCompleted = task.status === 'completed';
  // A completed one-off can always be reopened. A recurring task never reads
  // as "completed" (it just rolls to its next due date), so the undo for it
  // is only offered briefly after the completion — long enough to fix a
  // mis-tap, without showing the button on every recurring row forever.
  const completedRecently =
    task.lastCompletedAt !== null && Date.now() - new Date(task.lastCompletedAt).getTime() < UNDO_WINDOW_MS;
  const canUndo = isCompleted || completedRecently;

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
    <div className={isCompleted ? 'task-row task-row--completed' : 'task-row'}>
      <div>
        <strong>{task.title}</strong>
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
      </div>
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
        <button type="button" className="btn-small" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn-danger" onClick={() => remove.mutate(task.id)} disabled={remove.isPending}>
          Delete
        </button>
      </div>
    </div>
  );
}
