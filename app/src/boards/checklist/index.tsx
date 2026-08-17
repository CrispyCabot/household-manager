import { Link } from 'react-router';
import type { Board } from '@hhm/shared';
import { useChecklistItems } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { ChecklistBoardPage } from './ChecklistBoardPage.js';

function Card({ board }: { board: Board }) {
  const { data } = useChecklistItems(board.householdId, board.id);
  const items = data?.items ?? [];
  const remaining = items.filter((i) => !i.checked).length;

  return (
    <Link to={`/households/${board.householdId}/boards/${board.id}`} className="card">
      <strong>{board.title}</strong>
      <p>{items.length === 0 ? 'No items' : `${remaining} of ${items.length} left`}</p>
    </Link>
  );
}

registerBoardTypeUi('checklist', { Card, Page: ChecklistBoardPage });
