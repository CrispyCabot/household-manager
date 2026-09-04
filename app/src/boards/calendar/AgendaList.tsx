import { CalendarBoardConfigSchema } from '@hhm/shared';
import type { Board, CalendarView } from '@hhm/shared';
import { useMemo } from 'react';
import { useBoardEvents } from '../../api/queries.js';
import { formatDayHeading, formatEventTime, groupByDay, rangeForView } from './agenda.js';

/**
 * The day-grouped event list itself — fetches and renders, nothing else.
 * Used both by the full CalendarBoardPage and, in dashboard mode only, by
 * this board type's Card (registry.tsx's `dashboard` prop) to show the
 * board's *saved* view without a switcher.
 */
export function AgendaList({
  board,
  view,
  daysAhead,
  maxDays,
}: {
  board: Board;
  view: CalendarView;
  daysAhead: number;
  /** Caps how many day-groups render — the Card passes this so a busy calendar can't grow a dashboard tile without bound. */
  maxDays?: number;
}) {
  const config = CalendarBoardConfigSchema.parse(board.config);
  const { from, to } = useMemo(() => rangeForView(view, daysAhead), [view, daysAhead]);
  const { data, isLoading } = useBoardEvents(board.householdId, board.id, { from: from.toISOString(), to: to.toISOString() });

  const enabledCalendars = config.calendars.filter((c) => c.enabled);
  if (enabledCalendars.length === 0) {
    return <div className="empty">No calendars selected yet.</div>;
  }
  if (isLoading) return <p className="notice">Loading…</p>;

  const enabledIds = new Set(enabledCalendars.map((c) => c.id));
  const colourFor = (calendarId: string) => config.calendars.find((c) => c.id === calendarId)?.colour ?? 'var(--accent)';
  const grouped = groupByDay(data?.events ?? []);
  const visible = maxDays === undefined ? grouped : grouped.slice(0, maxDays);

  if (visible.length === 0) {
    return <div className="empty">Nothing on the calendar in this range.</div>;
  }

  return (
    <div className="calendar-agenda">
      {visible.map(([key, events]) => (
        <div key={key} className="calendar-agenda__day">
          <h2 className="calendar-agenda__heading">{formatDayHeading(key)}</h2>
          {events
            .filter((e) => enabledIds.has(e.calendarId))
            .map((event) => (
              <div key={event.id} className="calendar-event">
                <span className="calendar-event__dot" style={{ background: colourFor(event.calendarId) }} />
                <span className="calendar-event__time">{formatEventTime(event)}</span>
                <span className="calendar-event__title">{event.title}</span>
                {event.location !== null && event.location !== '' && <span className="calendar-event__location">{event.location}</span>}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
