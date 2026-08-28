export const EASTERN_TIME_ZONE = 'America/New_York';

/**
 * The Eastern-time UTC offset (in minutes, `local - UTC` — negative for a
 * zone west of UTC) in effect at the given real UTC instant. Used as a
 * one-shot approximation: the caller's `probeMs` is a wall-clock value
 * treated as if it were already UTC, which is off from the true UTC instant
 * by only the offset itself (~4-5 hours) — far short of enough to land on a
 * different DST regime except within the single skipped/repeated hour on a
 * transition day itself, which this deliberately does not special-case.
 */
function offsetMinutesAt(probeMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(probeMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const localFieldsAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (localFieldsAsUtcMs - probeMs) / 60_000;
}

/**
 * Converts a wall-clock date + time-of-day, as read on a clock in
 * `America/New_York`, to the UTC instant it represents — DST-aware, so the
 * same "00:00" resolves to a different UTC offset in January (EST, UTC-5)
 * than in July (EDT, UTC-4).
 */
export function easternWallClockToUtcIso(dateOnly: string, timeOfDay: string): string {
  const dateParts = dateOnly.split('-');
  const timeParts = timeOfDay.split(':');
  const [year, month, day] = [Number(dateParts[0]), Number(dateParts[1]), Number(dateParts[2])];
  const [hour, minute] = [Number(timeParts[0]), Number(timeParts[1])];
  const naiveMs = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMinutes = offsetMinutesAt(naiveMs);
  return new Date(naiveMs - offsetMinutes * 60_000).toISOString();
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The reverse of `easternWallClockToUtcIso`: a real UTC instant, read as a
 * wall-clock day-of-week (0=Sun..6=Sat) and minute-of-day in
 * `America/New_York`. Unlike the wall-clock-to-UTC direction, this needs no
 * offset arithmetic — `Intl.DateTimeFormat` resolves DST correctly from a
 * real instant on its own; the approximation in `offsetMinutesAt` exists
 * only because that other direction starts from an ambiguous wall-clock
 * reading, which isn't the case here.
 */
export function easternWallClockParts(instantIso: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instantIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { dow: WEEKDAY_INDEX[get('weekday')] ?? 0, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
