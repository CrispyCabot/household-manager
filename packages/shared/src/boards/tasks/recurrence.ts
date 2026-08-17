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
