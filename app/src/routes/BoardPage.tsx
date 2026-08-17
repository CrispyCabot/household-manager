import { Link, useParams } from 'react-router';
import { useBoards } from '../api/queries.js';
import { boardTypeUi } from '../boards/registry.js';

export function BoardPage() {
  const { householdId, boardId } = useParams<{ householdId: string; boardId: string }>();
  const { data, isLoading } = useBoards(householdId ?? null);

  if (isLoading) return <p className="notice">Loading…</p>;

  const board = data?.boards.find((b) => b.id === boardId);
  if (board === undefined) return <p className="notice">Board not found.</p>;

  const ui = boardTypeUi(board.type);
  if (ui === undefined) return <p className="notice">Unknown board type "{board.type}".</p>;

  return (
    <>
      <div className="back-link-row">
        <Link to="/" className="back-link">
          ← Boards
        </Link>
      </div>
      <ui.Page board={board} />
    </>
  );
}
