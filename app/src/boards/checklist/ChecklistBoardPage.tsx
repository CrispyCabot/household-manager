import { useState } from 'react';
import type { Board } from '@hhm/shared';
import { useChecklistItems, useCreateChecklistItem } from '../../api/queries.js';
import { ChecklistItemRow } from './ChecklistItemRow.js';

function AddItemForm({ householdId, boardId, onClose }: { householdId: string; boardId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const createItem = useCreateChecklistItem(householdId, boardId);

  return (
    <form
      className="item-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() === '') return;
        createItem.mutate({ text: text.trim() }, { onSuccess: () => setText('') });
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Milk" autoFocus />
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={createItem.isPending}>
          Add item
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </form>
  );
}

export function ChecklistBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useChecklistItems(board.householdId, board.id);
  const [adding, setAdding] = useState(false);

  return (
    <div className="page">
      <h1>{board.title}</h1>

      {isLoading && <p className="notice">Loading…</p>}
      {!isLoading && (data?.items.length ?? 0) === 0 && !adding && <div className="empty">No items yet.</div>}
      <div className="checklist">
        {(data?.items ?? []).map((item) => (
          <ChecklistItemRow key={item.id} householdId={board.householdId} item={item} />
        ))}
      </div>

      {adding ? (
        <AddItemForm householdId={board.householdId} boardId={board.id} onClose={() => setAdding(false)} />
      ) : (
        <div className="board-toolbar">
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            + Add item
          </button>
        </div>
      )}
    </div>
  );
}
