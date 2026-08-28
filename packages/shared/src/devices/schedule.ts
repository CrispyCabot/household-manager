import { easternWallClockParts } from '../time.js';
import type { ScheduleMode, ScheduleRule } from './schemas.js';

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':');
  return Number(hour) * 60 + Number(minute);
}

/** Length of the window in minutes, wrapping past midnight when `to <= from`. */
function ruleDurationMinutes(rule: ScheduleRule): number {
  const span = toMinutes(rule.to) - toMinutes(rule.from);
  return span > 0 ? span : span + 24 * 60;
}

/**
 * A day-of-week (0=Sun..6=Sat) plus minute-of-day, both already resolved to
 * Eastern wall-clock time — see `easternWallClockParts`.
 */
export interface WallClockMoment {
  dow: number;
  minutes: number;
}

/**
 * Evaluates which mode a device's schedule is in right now. Rules are
 * checked in order, first match wins; no match defaults to `'on'` — a
 * device with no schedule configured, or one that only lists `off`
 * windows, stays lit outside them rather than going dark by omission.
 *
 * A window that crosses midnight (e.g. `22:00`-`06:30`) is not stored as
 * two rules — it is normalised here, at evaluation time, into two
 * candidate intervals per rule: one anchored to *yesterday* (in case the
 * window started yesterday and is still running) and one anchored to
 * *today*. Both are checked against `now`; whichever the rule actually
 * spans is what matches.
 */
export function evaluateSchedule(rules: ScheduleRule[], now: WallClockMoment, yesterday: WallClockMoment): ScheduleMode {
  // "Today" occupies the absolute-minute range [1440, 2880); "yesterday"
  // occupies [0, 1440) on the same timeline, so a single now-vs-window
  // comparison works for a window anchored on either day.
  const nowAbs = 1440 + now.minutes;

  for (const rule of rules) {
    const duration = ruleDurationMinutes(rule);

    if (rule.days.includes(now.dow)) {
      const startAbs = 1440 + toMinutes(rule.from);
      if (nowAbs >= startAbs && nowAbs < startAbs + duration) return rule.mode;
    }

    if (rule.days.includes(yesterday.dow)) {
      const startAbs = toMinutes(rule.from);
      if (nowAbs >= startAbs && nowAbs < startAbs + duration) return rule.mode;
    }
  }

  return 'on';
}

/** Convenience wrapper — evaluates a schedule against a real UTC instant. */
export function evaluateScheduleAt(rules: ScheduleRule[], instantIso: string): ScheduleMode {
  const now = easternWallClockParts(instantIso);
  const yesterday = { dow: (now.dow + 6) % 7, minutes: now.minutes };
  return evaluateSchedule(rules, now, yesterday);
}
