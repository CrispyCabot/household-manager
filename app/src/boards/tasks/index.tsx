import { Link } from 'react-router';
import type { Board } from '@hhm/shared';
import { useTasks } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { TasksBoardPage } from './TasksBoardPage.js';

function Card({ board }: { board: Board }) {
  const { data } = useTasks(board.householdId, board.id);
  const count = data?.tasks.length ?? 0;

  return (
    <Link to={`/households/${board.householdId}/boards/${board.id}`} className="card">
      <strong>{board.title}</strong>
      <p>{count} task{count === 1 ? '' : 's'}</p>
    </Link>
  );
}

registerBoardTypeUi('tasks', { Card, Page: TasksBoardPage });
