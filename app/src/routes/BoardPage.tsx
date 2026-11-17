import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { logEvent } from '../analytics.js';
import { useBoards } from '../api/queries.js';
import { Loading } from '../components/Loading.js';
import { boardTypeUi } from '../boards/registry.js';

export function BoardPage() {
  const { householdId, boardId } = useParams<{ householdId: string; boardId: string }>();
  const { data, isLoading } = useBoards(householdId ?? null);
  const board = data?.boards.find((b) => b.id === boardId);
  const boardType = board?.type;

  useEffect(() => {
    if (boardType !== undefined) logEvent('board_opened', { board_type: boardType });
  }, [boardId, boardType]);

  if (isLoading) return <Loading />;

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
