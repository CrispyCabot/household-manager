import { easternWallClockToUtcIso } from '../../time.js';
import type { Recurrence, Task } from './schemas.js';

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Adds whole months, clamping to the last day of the resulting month rather
 * than overflowing into the next one — 1/31 plus one month is 2/28 (2/29 in
 * a leap year), never 3/3. Setting the date to 1 before shifting the month
 * avoids JS Date's own month-overflow behavior from ever kicking in.
 */
function addMonthsClampedUtc(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfResultMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfResultMonth));
  return d;
}

/** The next occurrence, `recurrence.every` `recurrence.unit`s after `fromIso`. */
export function nextOccurrence(fromIso: string, recurrence: Recurrence): string {
  const from = new Date(fromIso);
  switch (recurrence.unit) {
    case 'day':
      return addDaysUtc(from, recurrence.every).toISOString();
    case 'week':
      return addDaysUtc(from, recurrence.every * 7).toISOString();
    case 'month':
      return addMonthsClampedUtc(from, recurrence.every).toISOString();
    case 'year':
      return addMonthsClampedUtc(from, recurrence.every * 12).toISOString();
  }
}

/**
 * When nagging should begin: `leadTimeDays` before `dueAt`'s calendar date,
 * at `notifyTimeOfDay` (or midnight, if `null`) — read as a wall-clock time
 * in Eastern, not UTC, so "midnight" actually means midnight Eastern rather
 * than whatever hour UTC midnight happens to land on locally. Used both to
 * write `notifyAfter` and to evaluate live alerts.
 */
export function nagStart(dueAt: string, leadTimeDays: number, notifyTimeOfDay: string | null): string {
  const d = new Date(dueAt);
  d.setUTCDate(d.getUTCDate() - leadTimeDays);
  const dateOnly = d.toISOString().slice(0, 10);
  return easternWallClockToUtcIso(dateOnly, notifyTimeOfDay ?? '00:00');
}

/**
 * The DEFAULT renotify cadence for a task that hasn't been given its own —
 * how often a still-outstanding task should re-nag, given how often it
 * recurs. A daily or weekly chore left undone is urgent hour to hour, a
 * yearly one is not. Baseline: day/week -> hourly, monthly -> daily,
 * yearly -> weekly. A non-recurring task (`recurrence === null`) keeps the
 * app's original flat 24h interval. Only `unit` matters here, not `every`
 * — the baseline is stated per-unit, not per-occurrence.
 *
 * This is a *fallback*, not the live behavior of any given task — see
 * `effectiveRenotifyIntervalHours`, which is what callers that actually
 * need a task's real cadence should use instead.
 */
export function defaultRenotifyIntervalHours(recurrence: Recurrence | null): number {
  if (recurrence === null) return 24;
  switch (recurrence.unit) {
    case 'day':
    case 'week':
      return 1;
    case 'month':
      return 24;
    case 'year':
      return 24 * 7;
  }
}

/**
 * A task's real renotify cadence: its own explicit override if it has one,
 * else the recurrence-based default above. Every caller that determines how
 * a task actually behaves (the reminder sweep's snooze-forward, the email's
 * snooze link, the in-app snooze picker's starting point) goes through this
 * — never `defaultRenotifyIntervalHours` directly — so a task with a custom
 * cadence is honored everywhere consistently.
 */
export function effectiveRenotifyIntervalHours(task: Pick<Task, 'recurrence' | 'renotifyIntervalHours'>): number {
  return task.renotifyIntervalHours ?? defaultRenotifyIntervalHours(task.recurrence);
}

/** "1 hour" / "24 hours" -> "1 day" / "168 hours" -> "1 week" — whichever unit divides evenly, else falls back to hours. For a cadence, which is always one of a small set of round values (see the form's every/unit picker). */
export function formatRenotifyInterval(hours: number): string {
  if (hours % (24 * 7) === 0) {
    const weeks = hours / (24 * 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * "3 days, 4 hours" / "5 hours" / "2 days" — unlike `formatRenotifyInterval`
 * above, this never assumes `hours` divides evenly into a single round unit:
 * it's what the snooze slider's continuous days/hours duration (any integer
 * hour count, not just a cadence's round values) needs to display.
 */
export function formatDurationHours(hours: number): string {
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days === 0) return `${remainingHours} hour${remainingHours === 1 ? '' : 's'}`;
  if (remainingHours === 0) return `${days} day${days === 1 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}, ${remainingHours} hour${remainingHours === 1 ? '' : 's'}`;
}
