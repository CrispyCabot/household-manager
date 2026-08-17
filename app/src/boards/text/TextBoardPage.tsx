import type { Board } from '@hhm/shared';
import { useSaveTextDoc, useTextDoc } from '../../api/queries.js';
import { emptyBlocks } from './serialize.js';
import { TextEditor } from './TextEditor.js';

export function TextBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useTextDoc(board.householdId, board.id);
  const save = useSaveTextDoc(board.householdId, board.id);

  return (
    <div className="page">
      <h1>{board.title}</h1>
      {isLoading || data === undefined ? (
        <p className="notice">Loading…</p>
      ) : (
        <TextEditor
          initialBlocks={data.doc.blocks.length > 0 ? data.doc.blocks : emptyBlocks()}
          onSave={(blocks) => save.mutate(blocks)}
          saving={save.isPending}
        />
      )}
    </div>
  );
}
