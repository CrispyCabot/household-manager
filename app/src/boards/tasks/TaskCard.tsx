import type { Task } from '@hhm/shared';
import { useCompleteTask, useDeleteTask } from '../../api/queries.js';

export function TaskRow({ householdId, task }: { householdId: string; task: Task }) {
  const complete = useCompleteTask(householdId, task.boardId);
  const remove = useDeleteTask(householdId, task.boardId);

  const isCompleted = task.status === 'completed';

  return (
    <div className={isCompleted ? 'task-row task-row--completed' : 'task-row'}>
      <div>
        <strong>{task.title}</strong>
        {task.description !== '' && <p className="task-row__desc">{task.description}</p>}
        <span className="task-row__due">Due {new Date(task.dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}</span>
        {task.recurrence !== null && (
          <span className="task-row__recur">
            {' '}
            · every {task.recurrence.every} {task.recurrence.unit}
            {task.recurrence.every > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {!isCompleted && (
        <div className="task-row__actions">
          <button type="button" className="btn-primary" onClick={() => complete.mutate(task.id)} disabled={complete.isPending}>
            Complete
          </button>
          <button type="button" className="btn-small" onClick={() => remove.mutate(task.id)} disabled={remove.isPending}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
