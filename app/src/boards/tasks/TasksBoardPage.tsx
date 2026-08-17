import type { Board } from '@hhm/shared';
import { useTasks } from '../../api/queries.js';
import { TaskForm } from './TaskForm.js';
import { TaskRow } from './TaskCard.js';

export function TasksBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useTasks(board.householdId, board.id);

  return (
    <div className="page">
      <h1>{board.title}</h1>
      <TaskForm householdId={board.householdId} boardId={board.id} />
      {isLoading && <p className="notice">Loading…</p>}
      {!isLoading && (data?.tasks.length ?? 0) === 0 && <div className="empty">No tasks yet.</div>}
      <div className="task-list">
        {(data?.tasks ?? []).map((task) => (
          <TaskRow key={task.id} householdId={board.householdId} task={task} />
        ))}
      </div>
    </div>
  );
}
