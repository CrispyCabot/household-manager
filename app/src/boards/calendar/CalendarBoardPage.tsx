import { CalendarBoardConfigSchema } from '@hhm/shared';
import type { Board, CalendarEvent, CalendarView } from '@hhm/shared';
import { Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useBoardEvents } from '../../api/queries.js';
import { CalendarConfigPanel } from './CalendarConfigPanel.js';

/**
 * Week and month views reuse the same day-grouped agenda list as the
 * default view, just over a wider date range — a full calendar grid is
 * real extra work for less payoff on a screen meant to be read from across
 * a room (FEATURE_ANALYSIS.md's Phase 2: "For the wall display, the
 * agenda view is the one that matters"). This is a deliberate
 * simplification, not a stub — every view here is fully functional.
 */
function rangeForView(view: CalendarView, daysAhead: number): { from: Date; to: Date; days: number } {
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

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return 'All day';
  return new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function groupByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.start, event.allDay);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [event]);
    else bucket.push(event);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function formatDayHeading(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return isToday ? `Today — ${label}` : label;
}

export function CalendarBoardPage({ board }: { board: Board }) {
  const config = CalendarBoardConfigSchema.parse(board.config);
  const [view, setView] = useState<CalendarView>(config.defaultView);
  const [configOpen, setConfigOpen] = useState(false);

  const { from, to, days } = useMemo(() => rangeForView(view, config.daysAhead), [view, config.daysAhead]);
  const { data, isLoading } = useBoardEvents(board.householdId, board.id, { from: from.toISOString(), to: to.toISOString() });

  const enabledIds = new Set(config.calendars.filter((c) => c.enabled).map((c) => c.id));
  const colourFor = (calendarId: string) => config.calendars.find((c) => c.id === calendarId)?.colour ?? 'var(--accent)';
  const grouped = groupByDay(data?.events ?? []);

  return (
    <div className="page">
      <div className="household-header">
        <h1>{board.title}</h1>
        <div className="household-header__actions">
          <button type="button" className="masthead__iconbtn" title="Calendar settings" onClick={() => setConfigOpen(true)}>
            <Settings size={18} />
          </button>
        </div>
      </div>

      <div className="calendar-view-tabs">
        {(['agenda', 'week', 'month'] as const).map((v) => (
          <button key={v} type="button" className={v === view ? 'btn-small btn-small--active' : 'btn-small'} onClick={() => setView(v)}>
            {v === 'agenda' ? `Next ${days} days` : v[0]!.toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {config.calendars.filter((c) => c.enabled).length === 0 ? (
        <div className="empty">No calendars selected yet. Open settings to connect Google and choose which ones to show.</div>
      ) : isLoading ? (
        <p className="notice">Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="empty">Nothing on the calendar in this range.</div>
      ) : (
        <div className="calendar-agenda">
          {grouped.map(([key, events]) => (
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
      )}

      {configOpen && <CalendarConfigPanel board={board} onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
