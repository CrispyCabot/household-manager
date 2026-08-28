import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCalendars, listEvents } from './calendar.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listCalendars', () => {
  it('normalises the calendar list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [
            { id: 'primary-cal', summary: 'Household', backgroundColor: '#3f7d6b', primary: true },
            { id: 'other-cal', summary: 'Work' },
          ],
        }),
      })),
    );
    const calendars = await listCalendars('token');
    expect(calendars).toEqual([
      { id: 'primary-cal', summary: 'Household', backgroundColor: '#3f7d6b', primary: true },
      { id: 'other-cal', summary: 'Work', backgroundColor: null, primary: false },
    ]);
  });
});

describe('listEvents', () => {
  it('marks a date-only event as allDay and a dateTime event as timed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [
            { id: 'e1', summary: 'Bins', start: { date: '2026-03-05' }, end: { date: '2026-03-06' } },
            { id: 'e2', summary: 'Dentist', start: { dateTime: '2026-03-05T14:00:00Z' }, end: { dateTime: '2026-03-05T15:00:00Z' } },
          ],
        }),
      })),
    );
    const events = await listEvents('token', ['cal-1'], { from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' });
    expect(events).toEqual([
      { id: 'e1', calendarId: 'cal-1', title: 'Bins', start: '2026-03-05', end: '2026-03-06', allDay: true, location: null, description: null },
      {
        id: 'e2',
        calendarId: 'cal-1',
        title: 'Dentist',
        start: '2026-03-05T14:00:00Z',
        end: '2026-03-05T15:00:00Z',
        allDay: false,
        location: null,
        description: null,
      },
    ]);
  });

  it('merges and sorts events from multiple calendars by start time', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const isCalA = url.toString().includes('cal-a');
      return {
        ok: true,
        json: async () => ({
          items: isCalA
            ? [{ id: 'a1', summary: 'Later', start: { dateTime: '2026-03-05T18:00:00Z' }, end: { dateTime: '2026-03-05T19:00:00Z' } }]
            : [{ id: 'b1', summary: 'Earlier', start: { dateTime: '2026-03-05T09:00:00Z' }, end: { dateTime: '2026-03-05T10:00:00Z' } }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const events = await listEvents('token', ['cal-a', 'cal-b'], { from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' });
    expect(events.map((e) => e.id)).toEqual(['b1', 'a1']);
  });

  it('skips a malformed event (no start/end) instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: 'broken', summary: 'No dates' }] }) })),
    );
    const events = await listEvents('token', ['cal-1'], { from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' });
    expect(events).toEqual([]);
  });

  it('returns no events when passed no calendar ids', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const events = await listEvents('token', [], { from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' });
    expect(events).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
