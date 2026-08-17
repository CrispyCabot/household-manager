import type { Board } from '@hhm/shared';
import { useState } from 'react';
import { useSaveTextDoc, useTextDoc } from '../../api/queries.js';
import { emptyBlocks } from './serialize.js';
import { TextEditor } from './TextEditor.js';
import { TextView } from './TextView.js';

export function TextBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useTextDoc(board.householdId, board.id);
  const save = useSaveTextDoc(board.householdId, board.id);
  const [editing, setEditing] = useState(false);

  return (
    <div className="page">
      <h1>{board.title}</h1>
      {isLoading || data === undefined ? (
        <p className="notice">Loading…</p>
      ) : editing ? (
        <>
          <TextEditor
            initialBlocks={data.doc.blocks.length > 0 ? data.doc.blocks : emptyBlocks()}
            onSave={(blocks) => save.mutate(blocks)}
            saving={save.isPending}
          />
          <div className="board-toolbar">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <TextView blocks={data.doc.blocks} />
          <div className="board-toolbar">
            <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  );
}
