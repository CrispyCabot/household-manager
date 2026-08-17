import { useState } from 'react';
import type { ChecklistItem } from '@hhm/shared';
import { useDeleteChecklistItem, useRenameChecklistItem, useToggleChecklistItem } from '../../api/queries.js';

export function ChecklistItemRow({ householdId, item }: { householdId: string; item: ChecklistItem }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const toggle = useToggleChecklistItem(householdId, item.boardId);
  const rename = useRenameChecklistItem(householdId, item.boardId);
  const remove = useDeleteChecklistItem(householdId, item.boardId);

  if (editing) {
    return (
      <form
        className="item-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() === '') return;
          rename.mutate({ itemId: item.id, input: { text: text.trim() } }, { onSuccess: () => setEditing(false) });
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={rename.isPending}>
            Save
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setText(item.text);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={item.checked ? 'checklist-item checklist-item--checked' : 'checklist-item'}>
      <input
        type="checkbox"
        checked={item.checked}
        onChange={() => toggle.mutate(item.id)}
        disabled={toggle.isPending}
        aria-label={`Mark "${item.text}" ${item.checked ? 'not done' : 'done'}`}
      />
      <span className="checklist-item__text" onClick={() => setEditing(true)}>
        {item.text}
      </span>
      <button
        type="button"
        className="btn-small checklist-item__delete"
        onClick={() => remove.mutate(item.id)}
        disabled={remove.isPending}
      >
        Delete
      </button>
    </div>
  );
}
