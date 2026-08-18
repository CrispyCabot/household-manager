import type { Recurrence } from './schemas.js';

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

/** When nagging should begin: `leadTimeDays` before `dueAt`. Used both to write `notifyAfter` and to evaluate live alerts. */
export function nagStart(dueAt: string, leadTimeDays: number): string {
  const d = new Date(dueAt);
  d.setUTCDate(d.getUTCDate() - leadTimeDays);
  return d.toISOString();
}

/**
 * How often a still-outstanding task should re-nag, given how often it
 * recurs — a daily chore left undone is urgent hour to hour, a yearly one
 * is not. Baseline from the roadmap: daily -> hourly, monthly -> daily,
 * yearly -> weekly. `week` sits between daily and monthly recurrence and
 * isn't specified, so it takes the same interval as monthly (daily
 * renotify) — the nearer of the two given points. A non-recurring task
 * (`recurrence === null`) keeps the app's original flat 24h interval.
 * Only `unit` matters here, not `every` — the roadmap's baseline is stated
 * per-unit, not per-occurrence.
 */
export function renotifyIntervalHours(recurrence: Recurrence | null): number {
  if (recurrence === null) return 24;
  switch (recurrence.unit) {
    case 'day':
      return 1;
    case 'week':
    case 'month':
      return 24;
    case 'year':
      return 24 * 7;
  }
}
