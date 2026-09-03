import type { CalendarEvent, CalendarView } from '@hhm/shared';

/**
 * Week and month views reuse the same day-grouped agenda list as the
 * default view, just over a wider date range — a full calendar grid is
 * real extra work for less payoff on a screen meant to be read from across
 * a room (FEATURE_ANALYSIS.md's Phase 2: "For the wall display, the
 * agenda view is the one that matters"). This is a deliberate
 * simplification, not a stub — every view here is fully functional.
 *
 * Shared between CalendarBoardPage (the full page, with a view switcher)
 * and the calendar board's Card (which renders the board's *saved*
 * defaultView, with no switcher, only on a dashboard — see registry.tsx's
 * `dashboard` prop) so the two never drift into two different ideas of what
 * "this week" or "this month" means.
 */
export function rangeForView(view: CalendarView, daysAhead: number): { from: Date; to: Date; days: number } {
  const now = new Date();
  if (view === 'week') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    return { from: startOfWeek, to: endOfWeek, days: 7 };
  }
  if (view === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from: startOfMonth, to: startOfNextMonth, days: 31 };
  }
  const to = new Date(now);
  to.setDate(now.getDate() + daysAhead);
  return { from: now, to, days: daysAhead };
}

function dayKey(iso: string, allDay: boolean): string {
  // An all-day event's `start` is already a bare date ("YYYY-MM-DD"); a
  // timed event's is a full instant, whose *local* calendar date is what a
  // household actually cares about, not its UTC one.
  return allDay ? iso : new Date(iso).toLocaleDateString('en-CA');
}

export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return 'All day';
  return new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function groupByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.start, event.allDay);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [event]);
    else bucket.push(event);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function formatDayHeading(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return isToday ? `Today — ${label}` : label;
}
