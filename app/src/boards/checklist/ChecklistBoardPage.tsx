import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useState } from 'react';
import type { ChecklistItem } from '@hhm/shared';
import type { Board } from '@hhm/shared';
import { useChecklistItems, useCreateChecklistItem, useReorderChecklistItems } from '../../api/queries.js';
import { ChecklistItemRow } from './ChecklistItemRow.js';

function AddItemForm({ householdId, boardId, onClose }: { householdId: string; boardId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const createItem = useCreateChecklistItem(householdId, boardId);

  return (
    <form
      className="item-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() === '') return;
        createItem.mutate({ text: text.trim() }, { onSuccess: () => setText('') });
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Milk" autoFocus />
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={createItem.isPending}>
          Add item
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </form>
  );
}

/** An unchecked row that can be dragged by its grip — only the grip carries dnd-kit's listeners, so tapping the text/checkbox still works and touch scrolling isn't hijacked. */
function SortableItemRow({ householdId, item }: { householdId: string; item: ChecklistItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 1 : undefined, opacity: isDragging ? 0.85 : undefined }}
    >
      <ChecklistItemRow
        householdId={householdId}
        item={item}
        handle={
          <button type="button" className="checklist-item__grip" aria-label={`Drag to reorder "${item.text}"`} {...attributes} {...listeners}>
            <GripVertical size={16} />
          </button>
        }
      />
    </div>
  );
}

export function ChecklistBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useChecklistItems(board.householdId, board.id);
  const [adding, setAdding] = useState(false);
  const reorder = useReorderChecklistItems(board.householdId, board.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // A short press-and-hold on the grip, so a finger swiping the page to scroll never starts a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const items = data?.items ?? [];
  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over === null || active.id === over.id) return;
    const ids = unchecked.map((i) => i.id);
    reorder.mutate(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  return (
    <div className="page">
      <h1>{board.title}</h1>

      {isLoading && <p className="notice">Loading…</p>}
      {!isLoading && (data?.items.length ?? 0) === 0 && !adding && <div className="empty">No items yet.</div>}
      <div className="checklist">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={unchecked.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {unchecked.map((item) => (
              <SortableItemRow key={item.id} householdId={board.householdId} item={item} />
            ))}
          </SortableContext>
        </DndContext>
        {checked.map((item) => (
          <ChecklistItemRow key={item.id} householdId={board.householdId} item={item} />
        ))}
      </div>

      {adding ? (
        <AddItemForm householdId={board.householdId} boardId={board.id} onClose={() => setAdding(false)} />
      ) : (
        <div className="board-toolbar">
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            + Add item
          </button>
        </div>
      )}
    </div>
  );
}
