import { useState } from 'react';
import { boardType, boardTypeIds } from '@hhm/shared';
import { useCreateBoard } from '../api/queries.js';

export function AddBoardButton({ householdId }: { householdId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const typeIds = boardTypeIds();
  const [type, setType] = useState(() => typeIds[0] ?? '');
  const createBoard = useCreateBoard(householdId);

  if (!open) {
    return (
      <button type="button" className="btn-small" onClick={() => setOpen(true)}>
        + Add board
      </button>
    );
  }

  const selectedLabel = boardType(type)?.displayName ?? type;

  return (
    <form
      className="add-board"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '' || type === '') return;
        createBoard.mutate({ type, title: title.trim() }, { onSuccess: () => setOpen(false) });
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Board title" autoFocus />
      {typeIds.length > 1 && (
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {typeIds.map((id) => (
            <option key={id} value={id}>
              {boardType(id)?.displayName ?? id}
            </option>
          ))}
        </select>
      )}
      <button type="submit" className="btn-primary" disabled={createBoard.isPending || type === ''}>
        Add {selectedLabel}
      </button>
    </form>
  );
}
