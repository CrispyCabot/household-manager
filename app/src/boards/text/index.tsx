import { Link } from 'react-router';
import type { Board } from '@hhm/shared';
import { useTextDoc } from '../../api/queries.js';
import { SkeletonRows } from '../../components/Loading.js';
import { registerBoardTypeUi } from '../registry.js';
import { previewText } from './serialize.js';
import { TextBoardPage } from './TextBoardPage.js';
import { TextView } from './TextView.js';

/** On the wall dashboard the whole document is shown, formatted, and the card scrolls; elsewhere it's a two-line plain-text preview. */
function Card({ board, dashboard }: { board: Board; dashboard?: boolean }) {
  const { data, isLoading } = useTextDoc(board.householdId, board.id);
  const preview = data !== undefined ? previewText(data.doc.blocks) : '';

  return (
    <Link to={`/households/${board.householdId}/boards/${board.id}`} className="card textdoc-card">
      <strong>{board.title}</strong>
      {isLoading ? (
        <SkeletonRows count={2} />
      ) : preview === '' ? (
        <p className="textdoc-preview">Empty</p>
      ) : dashboard === true && data !== undefined ? (
        <TextView blocks={data.doc.blocks} />
      ) : (
        <p className="textdoc-preview">{preview}</p>
      )}
    </Link>
  );
}

registerBoardTypeUi('text', { Card, Page: TextBoardPage });
