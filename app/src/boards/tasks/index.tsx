import { Link } from 'react-router';
import type { Board } from '@hhm/shared';
import { useTasks } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { TasksBoardPage } from './TasksBoardPage.js';

const DEFAULT_PREVIEW_LIMIT = 3;

/** A tile taller than the default footprint (see registry.tsx's `size` doc comment) has room to list more upcoming tasks — roughly 2 more per extra row of height, capped well short of the board's full list. */
function previewLimitFor(size: { w: number; h: number } | undefined): number {
  if (size === undefined) return DEFAULT_PREVIEW_LIMIT;
  return Math.min(12, DEFAULT_PREVIEW_LIMIT + Math.max(0, size.h - 3) * 2);
}

function Card({ board, size }: { board: Board; size?: { w: number; h: number } }) {
  const { data } = useTasks(board.householdId, board.id);
  const tasks = data?.tasks ?? [];
  const count = tasks.length;
  const previewLimit = previewLimitFor(size);
  // listTasksForBoard doesn't sort, so the soonest-due active tasks are
  // found client-side rather than assumed to already be in order.
  const upcoming = tasks
    .filter((t) => t.status === 'active')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, previewLimit);

  return (
    <div className="card task-card">
      <Link to={`/households/${board.householdId}/boards/${board.id}`} className="task-card__header">
        <strong>{board.title}</strong>
        <p>{count} task{count === 1 ? '' : 's'}</p>
      </Link>
      {upcoming.length > 0 && (
        <div className="task-card__preview">
          {upcoming.map((task) => (
            <div key={task.id} className="task-card__preview-item">
              <span className="task-card__preview-title">{task.title}</span>
              <span className="task-card__preview-due">
                {' '}
                coming up {new Date(task.dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

registerBoardTypeUi('tasks', { Card, Page: TasksBoardPage });
