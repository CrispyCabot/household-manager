import { useState } from 'react';
import { useCreateBoard } from '../api/queries.js';

/** In phase 1 the registry was empty, so there was nothing to add — this is the first point creating a board means anything. */
const AVAILABLE_TYPES = [{ type: 'tasks', label: 'Tasks' }];

export function AddBoardButton({ householdId }: { householdId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const createBoard = useCreateBoard(householdId);

  if (!open) {
    return (
      <button type="button" className="btn-small" onClick={() => setOpen(true)}>
        + Add board
      </button>
    );
  }

  return (
    <form
      className="add-board"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '') return;
        createBoard.mutate({ type: 'tasks', title: title.trim() }, { onSuccess: () => setOpen(false) });
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Board title" autoFocus />
      <button type="submit" className="btn-primary" disabled={createBoard.isPending}>
        Add {AVAILABLE_TYPES[0]!.label}
      </button>
    </form>
  );
}
