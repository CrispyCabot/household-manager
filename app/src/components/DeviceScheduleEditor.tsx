import {
  DEFAULT_SCHEDULE,
  MINUTES_PER_DAY,
  groupScheduleRules,
  mergeAdjacentSegments,
  ungroupScheduleRules,
} from '@hhm/shared';
import type { ScheduleMode, ScheduleRule, ScheduleDayGroup, ScheduleSegment } from '@hhm/shared';
import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const SNAP_MINUTES = 15;
/** A segment needs at least twice this width to offer a "split" button — otherwise the two halves a split would create would themselves be smaller than a single drag-snap step. */
const MIN_SEGMENT_MINUTES = 30;

/** `ScheduleDayGroup` (the pure, testable, `@hhm/shared` representation) plus a local-only React key — never persisted, never round-tripped through `ungroupScheduleRules`. */
interface DayGroup extends ScheduleDayGroup {
  key: string;
}

/** "6:30 AM" — for on-screen labels only; the actual "HH:mm" sent to the API comes from `@hhm/shared`'s `ungroupScheduleRules`. */
function formatClock(min: number): string {
  const wrapped = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return new Date(2000, 0, 1, Math.floor(wrapped / 60), wrapped % 60).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

let groupKeySeq = 0;
function nextGroupKey(): string {
  groupKeySeq += 1;
  return `g${groupKeySeq}`;
}

function withKeys(groups: ScheduleDayGroup[]): DayGroup[] {
  return groups.map((g) => ({ ...g, key: nextGroupKey() }));
}

function toggleDay(days: number[], day: number): number[] {
  return (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]).sort((a, b) => a - b);
}

type DragState = { groupKey: string; boundaryIndex: number } | null;

/**
 * One day group's 24h picture — a horizontal bar of colored segments
 * (awake/asleep), draggable boundary handles between them, and per-segment
 * controls to toggle its mode or split it into two ("sections"). Dragging
 * itself is handled by the parent (`DeviceScheduleEditor`)'s window-level
 * pointermove listener, the same architecture `DashboardLayoutEditor` uses
 * for its own drag-to-resize — this component only starts a drag and
 * renders whatever `segments` it's given.
 */
function TimeBar({
  groupKey,
  segments,
  onChange,
  dragRef,
  barRefs,
}: {
  groupKey: string;
  segments: ScheduleSegment[];
  onChange: (segments: ScheduleSegment[]) => void;
  dragRef: MutableRefObject<DragState>;
  barRefs: MutableRefObject<Map<string, HTMLDivElement>>;
}) {
  function toggleMode(index: number) {
    const flipped: ScheduleMode = segments[index]!.mode === 'on' ? 'off' : 'on';
    onChange(mergeAdjacentSegments(segments.map((s, i) => (i === index ? { ...s, mode: flipped } : s))));
  }

  function addSection(index: number) {
    const start = segments[index]!.startMin;
    const end = index + 1 < segments.length ? segments[index + 1]!.startMin : MINUTES_PER_DAY;
    const mid = Math.round((start + (end - start) / 2) / SNAP_MINUTES) * SNAP_MINUTES;
    if (mid <= start || mid >= end) return;
    const opposite: ScheduleMode = segments[index]!.mode === 'on' ? 'off' : 'on';
    onChange([...segments.slice(0, index + 1), { startMin: mid, mode: opposite }, ...segments.slice(index + 1)]);
  }

  function removeBoundary(index: number) {
    if (index <= 0) return; // segment 0 always starts at midnight; nothing to merge it into.
    onChange(mergeAdjacentSegments(segments.filter((_, i) => i !== index)));
  }

  return (
    <div
      className="time-bar"
      ref={(el) => {
        if (el === null) barRefs.current.delete(groupKey);
        else barRefs.current.set(groupKey, el);
      }}
    >
      {segments.map((seg, i) => {
        const end = i + 1 < segments.length ? segments[i + 1]!.startMin : MINUTES_PER_DAY;
        const long = end - seg.startMin >= MIN_SEGMENT_MINUTES * 2;
        return (
          <div
            key={i}
            className={
              seg.mode === 'on' ? 'time-bar__segment time-bar__segment--on' : 'time-bar__segment time-bar__segment--off'
            }
            style={{ left: `${(seg.startMin / MINUTES_PER_DAY) * 100}%`, width: `${((end - seg.startMin) / MINUTES_PER_DAY) * 100}%` }}
          >
            <button type="button" className="time-bar__segment-toggle" onClick={() => toggleMode(i)}>
              <span>{seg.mode === 'on' ? 'Awake' : 'Asleep'}</span>
              <span className="time-bar__segment-range">
                {formatClock(seg.startMin)}–{formatClock(end)}
              </span>
            </button>
            {long && (
              <button type="button" className="time-bar__add-section" onClick={() => addSection(i)} title="Split into two sections">
                +
              </button>
            )}
          </div>
        );
      })}
      {segments.slice(1).map((seg, i) => (
        <div
          key={`handle-${i + 1}`}
          className="time-bar__handle"
          style={{ left: `${(seg.startMin / MINUTES_PER_DAY) * 100}%` }}
          onPointerDown={(e) => {
            e.preventDefault();
            dragRef.current = { groupKey, boundaryIndex: i + 1 };
          }}
        >
          <button
            type="button"
            className="time-bar__handle-remove"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => removeBoundary(i + 1)}
            title="Remove this boundary"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Edits a device's weekly schedule (FEATURE_ANALYSIS.md's Phase 1 "Schedule
 * model") as a 24-hour picture per day group, rather than typed time
 * fields — drag a boundary to move it, click a segment to flip
 * awake/asleep, split a segment into more "sections" when a single
 * wake/sleep split isn't enough for that group of days. Screensaver is not
 * a mode here at all — see `Device.screensaverEnabled` and its own
 * standalone toggle in `SettingsPage.tsx`'s `DeviceRow`.
 */
export function DeviceScheduleEditor({
  schedule,
  onSave,
  saving,
}: {
  schedule: ScheduleRule[];
  onSave: (schedule: ScheduleRule[]) => void;
  saving: boolean;
}) {
  const [groups, setGroups] = useState<DayGroup[]>(() => withKeys(groupScheduleRules(schedule)));
  const dragRef = useRef<DragState>(null);
  const barRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dirty = JSON.stringify(ungroupScheduleRules(groups)) !== JSON.stringify(schedule);

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (drag === null) return;
      const bar = barRefs.current.get(drag.groupKey);
      if (bar === undefined) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const rawMin = Math.round((ratio * MINUTES_PER_DAY) / SNAP_MINUTES) * SNAP_MINUTES;

      setGroups((current) =>
        current.map((g) => {
          if (g.key !== drag.groupKey) return g;
          const segs = g.segments;
          const i = drag.boundaryIndex;
          const prevStart = segs[i - 1]!.startMin;
          const nextStart = i + 1 < segs.length ? segs[i + 1]!.startMin : MINUTES_PER_DAY;
          const clamped = Math.max(prevStart + SNAP_MINUTES, Math.min(nextStart - SNAP_MINUTES, rawMin));
          return { ...g, segments: segs.map((s, j) => (j === i ? { ...s, startMin: clamped } : s)) };
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
  }, []);

  function addGroup() {
    const assigned = new Set(groups.flatMap((g) => g.days));
    const unassigned = [0, 1, 2, 3, 4, 5, 6].filter((d) => !assigned.has(d));
    const days = unassigned.length > 0 ? unassigned : [0, 1, 2, 3, 4, 5, 6];
    setGroups((current) => [...current, { key: nextGroupKey(), days, segments: [{ startMin: 0, mode: 'on' }] }]);
  }

  return (
    <div className="schedule-editor">
      {groups.map((group) => (
        <div key={group.key} className="schedule-group">
          <div className="schedule-group__header">
            <div className="schedule-rule__days">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  className={group.days.includes(day) ? 'schedule-day schedule-day--active' : 'schedule-day'}
                  onClick={() =>
                    setGroups((current) => current.map((g) => (g.key === group.key ? { ...g, days: toggleDay(g.days, day) } : g)))
                  }
                  aria-pressed={group.days.includes(day)}
                >
                  {label}
                </button>
              ))}
            </div>
            {groups.length > 1 && (
              <button type="button" className="btn-small" onClick={() => setGroups((current) => current.filter((g) => g.key !== group.key))}>
                Remove group
              </button>
            )}
          </div>
          <TimeBar
            groupKey={group.key}
            segments={group.segments}
            onChange={(segments) => setGroups((current) => current.map((g) => (g.key === group.key ? { ...g, segments } : g)))}
            dragRef={dragRef}
            barRefs={barRefs}
          />
        </div>
      ))}
      <div className="schedule-editor__actions">
        <button type="button" className="btn-small" onClick={addGroup}>
          Add day group
        </button>
        <button type="button" className="btn-small" onClick={() => setGroups(withKeys(groupScheduleRules(DEFAULT_SCHEDULE)))}>
          Reset to default
        </button>
        <button
          type="button"
          className="btn-small"
          onClick={() => setGroups([{ key: nextGroupKey(), days: [0, 1, 2, 3, 4, 5, 6], segments: [{ startMin: 0, mode: 'on' }] }])}
        >
          Always on
        </button>
        <span className="schedule-editor__spacer" />
        <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => onSave(ungroupScheduleRules(groups))}>
          Save schedule
        </button>
      </div>
    </div>
  );
}
