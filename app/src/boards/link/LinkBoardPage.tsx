import { useState } from 'react';
import type { Board } from '@hhm/shared';
import { useLinkDoc } from '../../api/queries.js';
import { LinkEditModal } from './LinkEditModal.js';
import { LINK_ICONS } from './icons.js';

/**
 * Reached by a direct link to /households/:hid/boards/:bid — the card on the
 * home page skips this and opens the URL straight away, so this page mostly
 * exists as a fallback view/edit entry point for anyone who lands here.
 */
export function LinkBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useLinkDoc(board.householdId, board.id);
  const [editing, setEditing] = useState(false);
  const url = data?.link.url ?? null;
  const icon = data?.link.icon ?? 'website';
  const { Icon } = LINK_ICONS[icon];

  return (
    <div className="page">
      <h1>{board.title}</h1>
      {isLoading ? (
        <p className="notice">Loading…</p>
      ) : (
        <div className="link-preview">
          <Icon size={40} className="link-preview__icon" aria-hidden="true" />
          {url !== null ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary">
              Open ↗
            </a>
          ) : (
            <p className="notice">No link set yet.</p>
          )}
        </div>
      )}
      <div className="board-toolbar">
        <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      {editing && (
        <LinkEditModal
          householdId={board.householdId}
          boardId={board.id}
          url={url}
          icon={icon}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
