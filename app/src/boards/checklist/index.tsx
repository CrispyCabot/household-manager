import { Link } from 'react-router';
import type { Board } from '@hhm/shared';
import { useChecklistItems, useToggleChecklistItem } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { ChecklistBoardPage } from './ChecklistBoardPage.js';

const PREVIEW_LIMIT = 5;

function Card({ board }: { board: Board }) {
  const { data } = useChecklistItems(board.householdId, board.id);
  const toggle = useToggleChecklistItem(board.householdId, board.id);
  const items = data?.items ?? [];
  // listChecklistItems already sorts unchecked-before-checked (by manual
  // position), so this is naturally "the next N things left to do" — not an
  // arbitrary top-5 that could include already-checked items.
  const remaining = items.filter((i) => !i.checked);
  const preview = remaining.slice(0, PREVIEW_LIMIT);
  const hasMore = remaining.length > PREVIEW_LIMIT;

  return (
    <div className="card checklist-card">
      <Link to={`/households/${board.householdId}/boards/${board.id}`} className="checklist-card__header">
        <strong>{board.title}</strong>
        <p>{items.length === 0 ? 'No items' : `${remaining.length} of ${items.length} left`}</p>
      </Link>
      {/* Sits outside the Link above (not nested inside it) so each checkbox
          toggles directly — clicking it here never navigates to the board. */}
      {preview.length > 0 && (
        <div className="checklist-card__preview">
          {preview.map((item) => (
            <label key={item.id} className="checklist-card__preview-item">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggle.mutate(item.id)}
                disabled={toggle.isPending}
                aria-label={`Mark "${item.text}" done`}
              />
              <span>{item.text}</span>
            </label>
          ))}
          {hasMore && <div className="checklist-card__more">&hellip;</div>}
        </div>
      )}
    </div>
  );
}

registerBoardTypeUi('checklist', { Card, Page: ChecklistBoardPage });
