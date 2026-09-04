import type { CalendarEvent, GoogleCalendar } from '@hhm/shared';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

interface GoogleCalendarListResponse {
  items?: { id: string; summary?: string; backgroundColor?: string; primary?: boolean }[];
}

export async function listCalendars(accessToken: string): Promise<GoogleCalendar[]> {
  const res = await fetch(`${API_BASE}/users/me/calendarList`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google calendarList.list failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as GoogleCalendarListResponse;
  return (body.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary ?? item.id,
    backgroundColor: item.backgroundColor ?? null,
    primary: item.primary ?? false,
  }));
}

interface GoogleEvent {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface GoogleEventsListResponse {
  items?: GoogleEvent[];
}

/** Normalises one Google event out of its dateTime/date split — see `CalendarEventSchema`'s doc comment for why nothing Google-shaped should leak past this function. */
function normalizeEvent(calendarId: string, event: GoogleEvent): CalendarEvent | null {
  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  if (startRaw === undefined || endRaw === undefined) return null; // malformed upstream data — skip rather than crash the whole board
  return {
    id: event.id,
    calendarId,
    title: event.summary ?? '(untitled)',
    start: startRaw,
    end: endRaw,
    allDay: event.start?.date !== undefined,
    location: event.location ?? null,
    description: event.description ?? null,
  };
}

/**
 * Events across every enabled calendar on a board, merged and sorted.
 * `singleEvents=true` is what makes a recurring Google event arrive as its
 * individual expanded occurrences rather than one RRULE-bearing master
 * event this app would then have to expand itself.
 */
export async function listEvents(accessToken: string, calendarIds: string[], range: { from: string; to: string }): Promise<CalendarEvent[]> {
  const perCalendar = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const url = new URL(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('timeMin', range.from);
      url.searchParams.set('timeMax', range.to);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`Google events.list failed for ${calendarId}: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as GoogleEventsListResponse;
      return (body.items ?? [])
        .map((event) => normalizeEvent(calendarId, event))
        .filter((event): event is CalendarEvent => event !== null);
    }),
  );
  return perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start));
}
