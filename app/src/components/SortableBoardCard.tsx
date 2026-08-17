import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Board } from '@hhm/shared';
import type { ReactNode } from 'react';

/**
 * Wraps a board type's own `Card` (always a `<Link className="card">`, see
 * e.g. boards/text/index.tsx) without any board type needing to know about
 * drag-and-drop. In reorder mode, clicks on the card body are swallowed at
 * the capture phase so the inner `<Link>` never navigates away mid-drag —
 * only the drag handle carries dnd-kit's listeners.
 */
export function SortableBoardCard({
  board,
  reorderMode,
  children,
}: {
  board: Board;
  reorderMode: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: board.id,
    disabled: !reorderMode,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'card-drag-wrapper card-drag-wrapper--dragging' : 'card-drag-wrapper'}
      onClickCapture={(e) => {
        if (reorderMode) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {reorderMode && (
        <button
          type="button"
          className="card-draghandle"
          aria-label={`Drag to reorder ${board.title}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      )}
      {children}
    </div>
  );
}
