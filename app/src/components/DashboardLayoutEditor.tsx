import type { Board, DashboardLayout, DashboardLayoutItem, Device } from '@hhm/shared';
import { useEffect, useRef, useState } from 'react';

const COLUMNS = 12;
const CELL_PX = 28;
const DEFAULT_ITEM_W = 4;
const DEFAULT_ITEM_H = 3;
const MIN_ROWS = 8;

type DragMode = { kind: 'move'; boardId: string; startX: number; startY: number; origX: number; origY: number } | { kind: 'resize'; boardId: string; startX: number; startY: number; origW: number; origH: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Where a new board lands by default — just below the current bottom of the layout, so items don't pile up on top of each other. */
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
  // `?? 1` guards against a layout saved before contentScale existed —
  // DashboardLayoutItemSchema's own `.default(1)` only applies when a value
  // actually goes through zod validation, not to a raw record already
  // sitting in DynamoDB (see api/src/db/devices.ts's fromItem, which casts
  // rather than parses).
  const [items, setItems] = useState<DashboardLayoutItem[]>(
    (device.layout?.items ?? []).map((i) => ({ ...i, contentScale: i.contentScale ?? 1 })),
  );
  const dragRef = useRef<DragMode | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const boardById = new Map(boards.map((b) => [b.id, b]));
  const placedIds = new Set(items.map((i) => i.boardId));
  const unplaced = boards.filter((b) => !placedIds.has(b.id));
  const rows = Math.max(MIN_ROWS, items.reduce((max, item) => Math.max(max, item.y + item.h), 0) + 2);
  const dirty = JSON.stringify(items) !== JSON.stringify(device.layout?.items ?? []);

  // A row's pixel height, distinct from a column's (CELL_PX) — filling
  // COLUMNS x MIN_ROWS (a "one screen's worth" reference size) should have
  // the same proportions as the device's own real screen, whatever shape
  // that is, so a layout arranged to fill it renders close to unscaled
  // rather than getting non-uniformly stretched by routes/Dashboard.tsx's
  // useFitToViewport to fill an actual screen shaped very differently from
  // what the editor implied (e.g. a 21:9 ultrawide, edited on a fixed
  // 12-column-wide, square-celled canvas that looks more like 3:2). Falls
  // back to square cells — today's behavior — until the device has
  // reported its own screen size at least once (useReportScreenSize,
  // Dashboard.tsx).
  const rowPx =
    device.screenWidth !== null && device.screenHeight !== null
      ? (CELL_PX * COLUMNS * device.screenHeight) / MIN_ROWS / device.screenWidth
      : CELL_PX;

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (drag === null) return;
      const deltaCellsX = Math.round((e.clientX - drag.startX) / CELL_PX);
      const deltaCellsY = Math.round((e.clientY - drag.startY) / rowPx);

      setItems((current) =>
        current.map((item) => {
          if (item.boardId !== drag.boardId) return item;
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
    dragRef.current = { kind: 'move', boardId: item.boardId, startX: e.clientX, startY: e.clientY, origX: item.x, origY: item.y };
  }

  function startResize(e: React.PointerEvent, item: DashboardLayoutItem) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind: 'resize', boardId: item.boardId, startX: e.clientX, startY: e.clientY, origW: item.w, origH: item.h };
  }

  function addBoard(boardId: string) {
    setItems([...items, { boardId, x: 0, y: nextFreeRow(items), w: DEFAULT_ITEM_W, h: DEFAULT_ITEM_H, contentScale: 1 }]);
  }

  function removeBoard(boardId: string) {
    setItems(items.filter((i) => i.boardId !== boardId));
  }

  function adjustScale(boardId: string, delta: number) {
    setItems(items.map((i) => (i.boardId === boardId ? { ...i, contentScale: clamp(i.contentScale + delta, 1, 3) } : i)));
  }

  return (
    <div className="layout-editor">
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        {device.screenWidth !== null && device.screenHeight !== null
          ? `Shaped to this device's own screen (${device.screenWidth}×${device.screenHeight}) — filling the grid below edge to edge should look right, not stretched.`
          : "This device hasn't reported its screen size yet — open the dashboard on it once, then come back here for a canvas shaped to match."}
      </p>
      <div
        ref={canvasRef}
        className="layout-editor__canvas"
        style={{ width: COLUMNS * CELL_PX, height: rows * rowPx }}
      >
        {items.map((item) => {
          const board = boardById.get(item.boardId);
          return (
            <div
              key={item.boardId}
              className="layout-editor__tile"
              style={{ left: item.x * CELL_PX, top: item.y * rowPx, width: item.w * CELL_PX, height: item.h * rowPx }}
              onPointerDown={(e) => startMove(e, item)}
            >
              <span className="layout-editor__tile-title">{board?.title ?? 'Unknown board'}</span>
              <button
                type="button"
                className="layout-editor__remove"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => removeBoard(item.boardId)}
              >
                ×
              </button>
              <div className="layout-editor__scale" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="layout-editor__scale-btn"
                  disabled={item.contentScale <= 1}
                  onClick={() => adjustScale(item.boardId, -0.25)}
                  title="Shrink this board's content back down"
                >
                  −
                </button>
                <span className="layout-editor__scale-value">{item.contentScale.toFixed(2).replace(/\.?0+$/, '')}x</span>
                <button
                  type="button"
                  className="layout-editor__scale-btn"
                  disabled={item.contentScale >= 3}
                  onClick={() => adjustScale(item.boardId, 0.25)}
                  title="Enlarge this board's content (font size and spacing) without changing its size on the grid"
                >
                  +
                </button>
              </div>
              <div className="layout-editor__resize-handle" onPointerDown={(e) => startResize(e, item)} />
            </div>
          );
        })}
      </div>

      {unplaced.length > 0 && (
        <div className="layout-editor__palette">
          <span className="notice" style={{ padding: 0 }}>
            Not on this dashboard:
          </span>
          {unplaced.map((board) => (
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
