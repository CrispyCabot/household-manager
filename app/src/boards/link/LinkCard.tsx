import { Pencil } from 'lucide-react';
import { useState } from 'react';
import type { Board } from '@hhm/shared';
import { useLinkDoc } from '../../api/queries.js';
import { LinkEditModal } from './LinkEditModal.js';
import { LINK_ICONS } from './icons.js';

export function LinkCard({ board }: { board: Board }) {
  const { data } = useLinkDoc(board.householdId, board.id);
  const [editing, setEditing] = useState(false);
  const url = data?.link.url ?? null;
  const icon = data?.link.icon ?? 'website';
  const { Icon } = LINK_ICONS[icon];

  return (
    <div className="link-card">
      {url !== null ? (
        <a className="card link-card__link" href={url} target="_blank" rel="noopener noreferrer">
          <Icon size={28} className="link-card__icon" aria-hidden="true" />
          <strong>{board.title}</strong>
        </a>
      ) : (
        <button type="button" className="card link-card__link" onClick={() => setEditing(true)}>
          <Icon size={28} className="link-card__icon" aria-hidden="true" />
          <strong>{board.title}</strong>
          <span className="link-card__hint">Tap to add a link</span>
        </button>
      )}
      <button
        type="button"
        className="link-card__edit"
        aria-label={`Edit ${board.title}`}
        title="Edit link"
        onClick={() => setEditing(true)}
      >
        <Pencil size={14} />
      </button>
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
