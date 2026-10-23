import type { Board, DashboardLayout, DashboardLayoutItem, Device } from '@hhm/shared';
import { useEffect, useRef, useState } from 'react';

const COLUMNS = 12;
const CELL_PX = 28;
const DEFAULT_ITEM_W = 4;
const DEFAULT_ITEM_H = 3;
/** How many rows of the grid make up one screen. The editor's canvas is shaped so these rows match the device's screen, and the dashboard (routes/Dashboard.tsx) divides its height into at least this many rows, so what's arranged here is what the screen shows. */
export const SCREEN_ROWS = 8;
/** The alerts panel has no `boardId` to key off of, and at most one of it ever makes sense on a layout — this fixed string stands in for it wherever items need a stable per-item identity (React `key`s, drag tracking, remove targeting). */
const ALERTS_ITEM_KEY = 'alerts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A stable identity for an item regardless of its kind — every `board` item's `boardId` is already unique (a board can only be placed once), and the singleton alerts item uses the reserved `ALERTS_ITEM_KEY`. */
function itemKey(item: DashboardLayoutItem): string {
  return item.kind === 'alerts' ? ALERTS_ITEM_KEY : item.boardId;
}

/**
 * `item.kind === 'alerts'` (not `(item.kind ?? 'board') === 'alerts'`) below
 * is deliberate: it both narrows the discriminated union correctly for
 * TypeScript *and* does the right thing at runtime for a layout saved
 * before the alerts panel became placeable — an old item has no `kind` at
 * all, `undefined !== 'alerts'` is `false`, and it falls into the 'board'
 * branch, exactly where its (always-present) `boardId` says it belongs.
 * Copying only the known fields also drops the per-tile `contentScale` zoom
 * that older saved layouts still carry, so the next save clears it.
 */
function normalizeItem(raw: DashboardLayoutItem): DashboardLayoutItem {
  if (raw.kind === 'alerts') {
    return { kind: 'alerts', x: raw.x, y: raw.y, w: raw.w, h: raw.h };
  }
  return { kind: 'board', boardId: raw.boardId, x: raw.x, y: raw.y, w: raw.w, h: raw.h };
}

type DragMode =
  | { kind: 'move'; itemKey: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'resize'; itemKey: string; startX: number; startY: number; origW: number; origH: number };

/** Where a new item lands by default — just below the current bottom of the layout, so items don't pile up on top of each other. */
function nextFreeRow(items: DashboardLayoutItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/**
 * A drag-to-move, drag-to-resize grid editor for a device's dashboard
 * layout (FEATURE_ANALYSIS.md's Phase 4) — plain pointer events rather than
 * `@dnd-kit` (already a dependency, used for the reorder-mode board grid on
 * Home.tsx), since dnd-kit has no built-in resize primitive and this needs
 * both move and resize to share the same coordinate math anyway.
 *
 * Places boards *and* the due-tasks alerts panel (routes/Dashboard.tsx's
 * `AlertBanner`) on the same grid, as the same kind of draggable/resizable
 * tile — the panel is otherwise a fixed, always-on-top, full-width
 * bar a household has no way to resize or reposition.
 *
 * Deliberately does not prevent overlaps — this is a single person
 * arranging their own wall display, not a multi-user layout with
 * correctness requirements; if two tiles end up overlapping, that's
 * visible immediately and trivial to drag apart, not worth the complexity
 * of a collision-avoidance algorithm.
 */
export function DashboardLayoutEditor({
  device,
  boards,
  onSave,
  saving,
}: {
  device: Device;
  boards: Board[];
  onSave: (layout: DashboardLayout | null) => void;
  saving: boolean;
}) {
  const [items, setItems] = useState<DashboardLayoutItem[]>((device.layout?.items ?? []).map(normalizeItem));
  const dragRef = useRef<DragMode | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const boardById = new Map(boards.map((b) => [b.id, b]));
  const placedBoardIds = new Set(items.filter((i) => i.kind === 'board').map((i) => i.boardId));
  const unplacedBoards = boards.filter((b) => !placedBoardIds.has(b.id));
  const alertsPlaced = items.some((i) => i.kind === 'alerts');
  const rows = Math.max(SCREEN_ROWS, items.reduce((max, item) => Math.max(max, item.y + item.h), 0) + 2);
  const dirty = JSON.stringify(items) !== JSON.stringify(device.layout?.items ?? []);

  // A row's pixel height, distinct from a column's (CELL_PX) — filling
  // COLUMNS x SCREEN_ROWS should have the same proportions as the device's
  // own screen, whatever shape that is. Falls back to square cells until the
  // device has reported its screen size at least once (useReportScreenSize,
  // Dashboard.tsx).
  const targetWidth = device.screenWidth;
  const targetHeight = device.screenHeight;
  const rowPx = targetWidth !== null && targetHeight !== null ? (CELL_PX * COLUMNS * targetHeight) / SCREEN_ROWS / targetWidth : CELL_PX;

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (drag === null) return;
      const deltaCellsX = Math.round((e.clientX - drag.startX) / CELL_PX);
      const deltaCellsY = Math.round((e.clientY - drag.startY) / rowPx);

      setItems((current) =>
        current.map((item) => {
          if (itemKey(item) !== drag.itemKey) return item;
          if (drag.kind === 'move') {
            return {
              ...item,
              x: clamp(drag.origX + deltaCellsX, 0, COLUMNS - item.w),
              y: clamp(drag.origY + deltaCellsY, 0, 999),
            };
          }
          return {
            ...item,
            w: clamp(drag.origW + deltaCellsX, 1, COLUMNS - item.x),
            h: clamp(drag.origH + deltaCellsY, 1, 999),
          };
        }),
      );
    }

    function onPointerUp() {
      dragRef.current = null;
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    // rowPx (unlike CELL_PX/COLUMNS) is derived from the `device` prop, not
    // a true constant — a stale closure over it would drag/resize items by
    // the wrong row height if the device's reported screen size changes
    // mid-session.
  }, [rowPx]);

  function startMove(e: React.PointerEvent, item: DashboardLayoutItem) {
    e.preventDefault();
    dragRef.current = { kind: 'move', itemKey: itemKey(item), startX: e.clientX, startY: e.clientY, origX: item.x, origY: item.y };
  }

  function startResize(e: React.PointerEvent, item: DashboardLayoutItem) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind: 'resize', itemKey: itemKey(item), startX: e.clientX, startY: e.clientY, origW: item.w, origH: item.h };
  }

  function addBoard(boardId: string) {
    setItems([...items, { kind: 'board', boardId, x: 0, y: nextFreeRow(items), w: DEFAULT_ITEM_W, h: DEFAULT_ITEM_H }]);
  }

  function addAlerts() {
    setItems([...items, { kind: 'alerts', x: 0, y: nextFreeRow(items), w: DEFAULT_ITEM_W, h: DEFAULT_ITEM_H }]);
  }

  function removeItem(key: string) {
    setItems(items.filter((i) => itemKey(i) !== key));
  }

  return (
    <div className="layout-editor">
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        {targetWidth !== null && targetHeight !== null ? (
          <>
            Shaped to this device's own screen ({targetWidth}×{targetHeight}) — the first {SCREEN_ROWS} rows are one screen. Boards
            with more content than fits scroll on their own.
          </>
        ) : (
          "This device hasn't reported its screen size yet — open the dashboard on it once, then come back here for a canvas shaped to match."
        )}
      </p>
      <div
        ref={canvasRef}
        className="layout-editor__canvas"
        style={{ width: COLUMNS * CELL_PX, height: rows * rowPx }}
      >
        {items.map((item) => {
          const key = itemKey(item);
          const label = item.kind === 'alerts' ? 'Notifications' : (boardById.get(item.boardId)?.title ?? 'Unknown board');
          return (
            <div
              key={key}
              className={item.kind === 'alerts' ? 'layout-editor__tile layout-editor__tile--alerts' : 'layout-editor__tile'}
              style={{ left: item.x * CELL_PX, top: item.y * rowPx, width: item.w * CELL_PX, height: item.h * rowPx }}
              onPointerDown={(e) => startMove(e, item)}
            >
              <span className="layout-editor__tile-title">{label}</span>
              <button
                type="button"
                className="layout-editor__remove"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => removeItem(key)}
              >
                ×
              </button>
              <div className="layout-editor__resize-handle" onPointerDown={(e) => startResize(e, item)} />
            </div>
          );
        })}
      </div>

      {(unplacedBoards.length > 0 || !alertsPlaced) && (
        <div className="layout-editor__palette">
          <span className="notice" style={{ padding: 0 }}>
            Not on this dashboard:
          </span>
          {!alertsPlaced && (
            <button type="button" className="btn-small" onClick={addAlerts}>
              + Notifications
            </button>
          )}
          {unplacedBoards.map((board) => (
            <button key={board.id} type="button" className="btn-small" onClick={() => addBoard(board.id)}>
              + {board.title}
            </button>
          ))}
        </div>
      )}

      <div className="schedule-editor__actions">
        <button type="button" className="btn-small" onClick={() => onSave(null)} disabled={saving}>
          Use automatic layout
        </button>
        <span className="schedule-editor__spacer" />
        <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => onSave({ columns: COLUMNS, items })}>
          Save layout
        </button>
      </div>
    </div>
  );
}
