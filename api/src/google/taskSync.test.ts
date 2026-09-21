import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board, Task } from '@hhm/shared';

vi.mock('./accessToken.js', () => ({ getAccessToken: vi.fn(async () => 'fake-access-token') }));
vi.mock('../db/boards.js', () => ({ loadBoard: vi.fn() }));
vi.mock('../db/client.js', () => ({ docClient: vi.fn(), tableName: vi.fn(() => 'fake-table') }));

const { deterministicEventId, eventBody, upsertEvent, syncTaskWrite } = await import('./taskSync.js');
const { loadBoard } = await import('../db/boards.js');
const { docClient } = await import('../db/client.js');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(loadBoard).mockReset();
  vi.mocked(docClient).mockReset();
});

function makeBoard(config: Record<string, unknown>): Board {
  return {
    id: 'bd-1',
    householdId: 'hh-1',
    type: 'tasks',
    title: 'Tasks',
    position: 0,
    config,
    createdAt: now,
    updatedAt: now,
  };
}

/** Stubs `docClient().send` and returns the UpdateCommand inputs it was called with, in order. */
function stubDocClient(): { updates: () => Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  vi.mocked(docClient).mockReturnValue({
    send: vi.fn(async (cmd: { input: Record<string, unknown> }) => {
      calls.push(cmd.input);
      return {};
    }),
  } as unknown as ReturnType<typeof docClient>);
  return { updates: () => calls };
}

const now = new Date().toISOString();

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    householdId: 'hh-1',
    boardId: 'bd-1',
    title: 'Take out bins',
    description: '',
    dueAt: '2026-03-05T00:00:00.000Z',
    recurrence: null,
    leadTimeDays: 0,
    notifyTimeOfDay: null,
    renotifyIntervalHours: null,
    notify: { inApp: true, email: true },
    status: 'active',
    snoozedUntil: null,
    dismissed: false,
    notifyAfter: null,
    lastCompletedAt: null,
    lastCompletedBy: null,
    syncToCalendar: null,
    googleEventId: null,
    googleCalendarId: null,
    syncState: 'ok',
    syncError: null,
    createdBy: 'user-1',
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

describe('deterministicEventId', () => {
  it('is deterministic for the same task and occurrence', () => {
    expect(deterministicEventId('task-1', '2026-03-05T00:00:00.000Z')).toBe(deterministicEventId('task-1', '2026-03-05T00:00:00.000Z'));
  });

  it('differs across tasks', () => {
    expect(deterministicEventId('task-1', '2026-03-05T00:00:00.000Z')).not.toBe(deterministicEventId('task-2', '2026-03-05T00:00:00.000Z'));
  });

  it('differs across occurrences of the same task (a completed recurring task gets a new event)', () => {
    expect(deterministicEventId('task-1', '2026-03-05T00:00:00.000Z')).not.toBe(deterministicEventId('task-1', '2026-04-05T00:00:00.000Z'));
  });

  it('is valid base32hex — Google Calendar event ID constraints', () => {
    const id = deterministicEventId('task-1', '2026-03-05T00:00:00.000Z');
    expect(id).toMatch(/^[0-9a-v]+$/);
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id.length).toBeLessThanOrEqual(1024);
  });
});

describe('eventBody', () => {
  it('builds an all-day event (exclusive end date) when notifyTimeOfDay is unset', () => {
    const body = eventBody(makeTask({ dueAt: '2026-03-05T00:00:00.000Z', notifyTimeOfDay: null }));
    expect(body.start).toEqual({ date: '2026-03-05' });
    expect(body.end).toEqual({ date: '2026-03-06' });
  });

  it('builds a 30-minute timed event at notifyTimeOfDay, in Eastern', () => {
    const body = eventBody(makeTask({ dueAt: '2026-03-05T00:00:00.000Z', notifyTimeOfDay: '14:30' }));
    // 2026-03-05 is before that year's spring-forward (2026-03-08) — still EST (UTC-5), so 14:30 Eastern is 19:30Z.
    expect(body.start).toEqual({ dateTime: '2026-03-05T19:30:00.000Z' });
    expect(body.end).toEqual({ dateTime: '2026-03-05T20:00:00.000Z' });
  });

  it('omits description when empty, includes it when present', () => {
    expect(eventBody(makeTask({ description: '' }))).not.toHaveProperty('description');
    expect(eventBody(makeTask({ description: 'Curbside by 7am' }))).toHaveProperty('description', 'Curbside by 7am');
  });

  it('carries the task identity in extendedProperties for traceability', () => {
    const body = eventBody(makeTask({ id: 'task-1', boardId: 'bd-1', householdId: 'hh-1' }));
    expect(body.extendedProperties).toEqual({ private: { hhmTaskId: 'task-1', hhmBoardId: 'bd-1', hhmHouseholdId: 'hh-1' } });
  });
});

describe('upsertEvent', () => {
  it('updates (PUT) first, and does not insert when the update succeeds', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await upsertEvent('hh-1', 'cal-1', 'event-1', makeTask());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'PUT' });
  });

  it('falls back to insert (POST) when the update 404s — first-ever sync of this occurrence', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'PUT') return { ok: false, status: 404, text: async () => 'not found' };
      return { ok: true, status: 200, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    await upsertEvent('hh-1', 'cal-1', 'event-1', makeTask());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
    const insertedBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(insertedBody.id).toBe('event-1');
  });

  it('throws on a non-404 update failure, without attempting insert', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'server error' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(upsertEvent('hh-1', 'cal-1', 'event-1', makeTask())).rejects.toThrow(/events\.update failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('syncTaskWrite', () => {
  it('is a misconfiguration, not a silent no-op, when sync is wanted but the board has no calendar selected', async () => {
    vi.mocked(loadBoard).mockResolvedValue(makeBoard({ googleSync: { enabled: false, calendarId: null } }));
    const { updates } = stubDocClient();

    // syncToCalendar: true overrides the board's disabled default — this is
    // exactly the "I enabled sync on a task" bug report, with the board's
    // googleSync.calendarId left unset because no UI ever set it.
    await syncTaskWrite(makeTask({ syncToCalendar: true }));

    const last = updates().at(-1)!;
    expect(last.UpdateExpression).toContain('syncState');
    expect((last.ExpressionAttributeValues as Record<string, unknown>)[':state']).toBe('error');
    expect((last.ExpressionAttributeValues as Record<string, unknown>)[':error']).toMatch(/no google calendar is selected/i);
  });

  it('is a plain no-sync-wanted case, not an error, when the board default is off and the task does not override it', async () => {
    vi.mocked(loadBoard).mockResolvedValue(makeBoard({ googleSync: { enabled: false, calendarId: null } }));
    const { updates } = stubDocClient();

    await syncTaskWrite(makeTask({ syncToCalendar: null }));

    const last = updates().at(-1)!;
    expect((last.ExpressionAttributeValues as Record<string, unknown>)[':state']).toBe('ok');
    expect((last.ExpressionAttributeValues as Record<string, unknown>)[':error']).toBeNull();
  });

  it('still writes the event once sync is enabled and a calendar is selected', async () => {
    vi.mocked(loadBoard).mockResolvedValue(makeBoard({ googleSync: { enabled: true, calendarId: 'cal-1' } }));
    const { updates } = stubDocClient();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await syncTaskWrite(makeTask({ syncToCalendar: null }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const last = updates().at(-1)!;
    expect((last.ExpressionAttributeValues as Record<string, unknown>)[':state']).toBe('ok');
    expect((last.ExpressionAttributeValues as Record<string, unknown>)[':error']).toBeNull();
    expect((last.ExpressionAttributeValues as Record<string, unknown>)[':calId']).toBe('cal-1');
  });

  it('never throws, even when the board fails to load', async () => {
    vi.mocked(loadBoard).mockRejectedValue(new Error('dynamo is down'));
    stubDocClient();

    await expect(syncTaskWrite(makeTask())).resolves.toBeUndefined();
  });
});
