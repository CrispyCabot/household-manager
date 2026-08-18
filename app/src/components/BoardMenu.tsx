import { MoreVertical } from 'lucide-react';
import { useState } from 'react';
import type { Board } from '@hhm/shared';
import { useDeleteBoard, useUpdateBoard } from '../api/queries.js';

type MenuState = 'closed' | 'menu' | 'renaming' | 'confirming-delete';

/**
 * Sits inside `SortableBoardCard`'s own wrapper (`.card-drag-wrapper`,
 * already `position: relative`) alongside the board type's own `<Card>` —
 * same positioning trick as `.card-draghandle` and `.link-card__edit`. Only
 * rendered outside reorder mode (Home.tsx), so it never fights the drag
 * handle for the same corner.
 */
export function BoardMenu({ householdId, board }: { householdId: string; board: Board }) {
  const [state, setState] = useState<MenuState>('closed');
  const [title, setTitle] = useState(board.title);
  const updateBoard = useUpdateBoard(householdId);
  const deleteBoard = useDeleteBoard(householdId);

  function close() {
    setState('closed');
    setTitle(board.title);
  }

  return (
    <>
      <button
        type="button"
        className="board-menu__trigger"
        aria-label={`Board options for ${board.title}`}
        title="Board options"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setState('menu');
        }}
      >
        <MoreVertical size={16} />
      </button>

      {state === 'menu' && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{board.title}</h2>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setState('renaming')}>
                Rename
              </button>
              <button type="button" className="btn-danger" onClick={() => setState('confirming-delete')}>
                Delete
              </button>
              <button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {state === 'renaming' && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Rename board</h2>
            <form
              className="board-menu-form"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = title.trim();
                if (trimmed === '' || trimmed === board.title) {
                  close();
                  return;
                }
                updateBoard.mutate({ boardId: board.id, title: trimmed }, { onSuccess: close });
              }}
            >
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={updateBoard.isPending || title.trim() === ''}>
                  Save
                </button>
                <button type="button" className="btn-secondary" onClick={close}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {state === 'confirming-delete' && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete "{board.title}"?</h2>
            <p className="notice">This permanently deletes everything inside this board. This cannot be undone.</p>
            <div className="form-actions">
              <button
                type="button"
                className="btn-danger"
                disabled={deleteBoard.isPending}
                onClick={() => deleteBoard.mutate(board.id, { onSuccess: close })}
              >
                Delete board
              </button>
              <button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
