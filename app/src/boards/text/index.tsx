import { Link } from 'react-router';
import type { Board } from '@hhm/shared';
import { useTextDoc } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { previewText } from './serialize.js';
import { TextBoardPage } from './TextBoardPage.js';

function Card({ board }: { board: Board }) {
  const { data } = useTextDoc(board.householdId, board.id);
  const preview = data !== undefined ? previewText(data.doc.blocks) : '';

  return (
    <Link to={`/households/${board.householdId}/boards/${board.id}`} className="card">
      <strong>{board.title}</strong>
      <p className="textdoc-preview">{preview === '' ? 'Empty' : preview}</p>
    </Link>
  );
}

registerBoardTypeUi('text', { Card, Page: TextBoardPage });
