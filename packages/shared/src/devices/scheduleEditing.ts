import type { ScheduleMode, ScheduleRule } from './schemas.js';

export const MINUTES_PER_DAY = 1440;

export interface ScheduleSegment {
  /** Minutes since midnight this segment starts at. The first segment of a group always starts at 0. */
  startMin: number;
  mode: ScheduleMode;
}

export interface ScheduleDayGroup {
  days: number[];
  /** Sorted ascending by `startMin`; always covers the full 24h with no gaps. */
  segments: ScheduleSegment[];
}

export function timeOfDayToMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

export function minutesToTimeOfDay(min: number): string {
  const wrapped = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Drops a boundary whose segment has the same mode as the one before it — a caller should never end up with (or save) two adjacent segments a person couldn't tell apart. */
export function mergeAdjacentSegments(segments: ScheduleSegment[]): ScheduleSegment[] {
  const result: ScheduleSegment[] = [];
  for (const seg of segments) {
    const last = result[result.length - 1];
    if (last !== undefined && last.mode === seg.mode) continue;
    result.push(seg);
  }
  return result;
}

/**
 * A rule's `(from, to, mode)` as one interval, or two if it crosses
 * midnight (`to <= from`) — `(from, 24:00)` and `(00:00, to)`. Undoing this
 * is what lets a wrapping rule like the shipped default's `22:00`-`06:30`
 * "off" window render as a single 24h picture instead of assuming every
 * rule falls on one calendar day.
 */
function unwrapRule(rule: ScheduleRule): { start: number; end: number; mode: ScheduleMode }[] {
  const from = timeOfDayToMinutes(rule.from);
  const to = timeOfDayToMinutes(rule.to);
  if (to > from) return [{ start: from, end: to, mode: rule.mode }];
  return [
    { start: from, end: MINUTES_PER_DAY, mode: rule.mode },
    { start: 0, end: to, mode: rule.mode },
  ];
}

/**
 * Groups a device's schedule rules by which days they apply to, and
 * resolves each group into one 24h picture of segments — the shape a
 * visual day/night editor needs, as opposed to a flat rule list. A gap
 * before the first covered minute defaults to "on", matching
 * `evaluateSchedule`'s own "no match => on" fallback (`schedule.ts`).
 */
export function groupScheduleRules(rules: ScheduleRule[]): ScheduleDayGroup[] {
  const byDays = new Map<string, ScheduleRule[]>();
  for (const rule of rules) {
    const key = JSON.stringify([...rule.days].sort((a, b) => a - b));
    byDays.set(key, [...(byDays.get(key) ?? []), rule]);
  }
  const groups: ScheduleDayGroup[] = [];
  for (const [key, groupRules] of byDays) {
    const days = JSON.parse(key) as number[];
    const intervals = groupRules.flatMap(unwrapRule).sort((a, b) => a.start - b.start);
    let segments: ScheduleSegment[] = intervals.map((iv) => ({ startMin: iv.start, mode: iv.mode }));
    if (segments[0]?.startMin !== 0) {
      segments = [{ startMin: 0, mode: 'on' }, ...segments];
    }
    groups.push({ days, segments: mergeAdjacentSegments(segments) });
  }
  return groups;
}

/**
 * The inverse of `groupScheduleRules` — with one deliberate wrinkle: when a
 * group's first and last segment share the same mode (e.g. asleep both
 * right after midnight and right before it), those two are re-merged into
 * a single rule that wraps past midnight, rather than emitted as two
 * separate same-day rules. That's not just cosmetic — `evaluateSchedule`
 * (`schedule.ts`) matches a wrapping rule against *yesterday's* day-of-week
 * for its carried-over portion, which is what makes the shipped default's
 * Friday-night sleep window correctly keep the screen off into Saturday
 * morning even though Saturday itself isn't one of the weekday rule's
 * days. Splitting that same window into two flat, same-day rules instead
 * (one "00:00-06:30", one "22:00-00:00") would silently drop that
 * carry-over — each would only ever match on a day that's actually in the
 * group's own `days` list, never the day before it.
 */
export function ungroupScheduleRules(groups: ScheduleDayGroup[]): ScheduleRule[] {
  const rules: ScheduleRule[] = [];
  for (const group of groups) {
    const segs = group.segments;
    if (segs.length === 0) continue;
    if (segs.length === 1) {
      rules.push({ days: group.days, from: '00:00', to: '00:00', mode: segs[0]!.mode });
      continue;
    }

    const wraps = segs[0]!.mode === segs[segs.length - 1]!.mode;
    if (!wraps) {
      for (let i = 0; i < segs.length; i++) {
        const toMin = i + 1 < segs.length ? segs[i + 1]!.startMin : MINUTES_PER_DAY;
        rules.push({ days: group.days, from: minutesToTimeOfDay(segs[i]!.startMin), to: minutesToTimeOfDay(toMin), mode: segs[i]!.mode });
      }
      continue;
    }

    // The first and last segments are really one continuous run through
    // midnight — emit every segment in between normally, then one wrapping
    // rule for the merged first+last pair.
    for (let i = 1; i < segs.length - 1; i++) {
      rules.push({ days: group.days, from: minutesToTimeOfDay(segs[i]!.startMin), to: minutesToTimeOfDay(segs[i + 1]!.startMin), mode: segs[i]!.mode });
    }
    rules.push({
      days: group.days,
      from: minutesToTimeOfDay(segs[segs.length - 1]!.startMin),
      to: minutesToTimeOfDay(segs[1]!.startMin),
      mode: segs[segs.length - 1]!.mode,
    });
  }
  return rules;
}
