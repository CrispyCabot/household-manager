import { useState } from 'react';
import type { LinkIcon } from '@hhm/shared';
import { useSaveLinkDoc } from '../../api/queries.js';
import { LINK_ICON_KEYS, LINK_ICONS } from './icons.js';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

interface LinkEditModalProps {
  householdId: string;
  boardId: string;
  url: string | null;
  icon: LinkIcon;
  onClose: () => void;
}

export function LinkEditModal({ householdId, boardId, url, icon, onClose }: LinkEditModalProps) {
  const [urlInput, setUrlInput] = useState(url ?? '');
  const [iconInput, setIconInput] = useState<LinkIcon>(icon);
  const save = useSaveLinkDoc(householdId, boardId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit link</h2>
        <form
          className="link-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (urlInput.trim() === '') return;
            save.mutate({ url: normalizeUrl(urlInput), icon: iconInput }, { onSuccess: onClose });
          }}
        >
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="e.g. sheets.google.com/…"
            autoFocus
          />
          <div className="link-icon-picker">
            {LINK_ICON_KEYS.map((key) => {
              const { Icon, label } = LINK_ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={
                    key === iconInput
                      ? 'link-icon-picker__option link-icon-picker__option--selected'
                      : 'link-icon-picker__option'
                  }
                  title={label}
                  aria-label={label}
                  aria-pressed={key === iconInput}
                  onClick={() => setIconInput(key)}
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={save.isPending || urlInput.trim() === ''}>
              Save
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
