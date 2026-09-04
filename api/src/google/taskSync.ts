import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { TasksBoardConfigSchema, easternWallClockToUtcIso, householdPk } from '@hhm/shared';
import type { CalendarSyncState, Task } from '@hhm/shared';
import { loadBoard } from '../db/boards.js';
import { docClient, tableName } from '../db/client.js';
import { fromItem, taskSk } from '../db/tasks.js';
import { getAccessToken } from './accessToken.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Deterministic per-occurrence event id (FEATURE_ANALYSIS.md's Phase 3:
 * "use a client-specified event ID ... so a retried create is idempotent").
 * Google event IDs must be lowercase base32hex (`0-9a-v`), 5-1024 chars —
 * a lowercase hex digest already satisfies that (hex is a strict subset of
 * base32hex's alphabet), so no separate re-encoding step is needed. Keyed
 * by `dueAt`, not just the task id: completing a recurring task changes
 * `dueAt` to the next occurrence, which is meant to produce a *different*
 * event — see `syncTaskWrite`'s handling of a changed event id below.
 */
export function deterministicEventId(taskId: string, dueAt: string): string {
  return createHash('sha256').update(`hhm-task-${taskId}-${dueAt}`).digest('hex').slice(0, 40);
}

function nextCalendarDate(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * `task.dueAt`'s UTC calendar date IS the intended date — the same
 * convention `boards/tasks/index.tsx`'s Card and `AlertBanner` already use
 * (`toLocaleDateString(..., { timeZone: 'UTC' })`), because the task form
 * only ever collects a bare date and converts it with `new Date(dateOnly)`,
 * which parses as UTC midnight. A timed event (when `notifyTimeOfDay` is
 * set) is the one place that date needs to become an actual Eastern
 * instant, via the same `easternWallClockToUtcIso` the reminder system uses.
 */
export function eventBody(task: Task): Record<string, unknown> {
  const dateOnly = task.dueAt.slice(0, 10);
  const dates =
    task.notifyTimeOfDay === null
      ? { start: { date: dateOnly }, end: { date: nextCalendarDate(dateOnly) } }
      : (() => {
          const startIso = easternWallClockToUtcIso(dateOnly, task.notifyTimeOfDay);
          const endIso = new Date(new Date(startIso).getTime() + 30 * 60_000).toISOString();
          return { start: { dateTime: startIso }, end: { dateTime: endIso } };
        })();

  return {
    summary: task.title,
    ...(task.description === '' ? {} : { description: task.description }),
    // What a reconciliation pass (or a human digging in Google's UI) could
    // use to trace an event back to its task — not read by this app today.
    extendedProperties: { private: { hhmTaskId: task.id, hhmBoardId: task.boardId, hhmHouseholdId: task.householdId } },
    ...dates,
  };
}

export async function upsertEvent(householdId: string, calendarId: string, eventId: string, task: Task): Promise<void> {
  const accessToken = await getAccessToken(householdId);
  const body = eventBody(task);
  const base = `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

  // Update-first, not insert-with-catch-409: a retried write (the whole
  // point of a deterministic id) should converge on the same event whether
  // this is the first attempt or the fifth, and PUT already has exactly
  // that "create or replace" semantic once the id exists — the only case
  // insert is needed for is the true first write, signaled by 404 here.
  const updateRes = await fetch(`${base}/${eventId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (updateRes.ok) return;
  if (updateRes.status !== 404) {
    throw new Error(`Google events.update failed: ${updateRes.status} ${await updateRes.text()}`);
  }

  const insertRes = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, id: eventId }),
  });
  if (!insertRes.ok) {
    throw new Error(`Google events.insert failed: ${insertRes.status} ${await insertRes.text()}`);
  }
}

async function deleteEvent(householdId: string, calendarId: string, eventId: string): Promise<void> {
  const accessToken = await getAccessToken(householdId);
  const res = await fetch(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404/410: already gone (a previous attempt's delete succeeded but this
  // process never saw the response, or a human deleted it directly) —
  // exactly the outcome being asked for, not a failure.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google events.delete failed: ${res.status} ${await res.text()}`);
  }
}

async function setSyncFields(
  task: Pick<Task, 'householdId' | 'boardId' | 'id'>,
  patch: { syncState: CalendarSyncState; syncError: string | null; googleEventId?: string | null; googleCalendarId?: string | null },
): Promise<void> {
  const sets = ['syncState = :state', 'syncError = :error'];
  const values: Record<string, unknown> = { ':state': patch.syncState, ':error': patch.syncError };
  if (patch.googleEventId !== undefined) {
    sets.push('googleEventId = :eventId');
    values[':eventId'] = patch.googleEventId;
  }
  if (patch.googleCalendarId !== undefined) {
    sets.push('googleCalendarId = :calId');
    values[':calId'] = patch.googleCalendarId;
  }
  try {
    await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(task.householdId), SK: taskSk(task.boardId, task.id) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: values,
      }),
    );
  } catch (err) {
    // The task was deleted between this sync attempt starting and finishing
    // — nothing to record sync state on any more, which is fine.
    if (!(err instanceof Error && err.name === 'ConditionalCheckFailedException')) throw err;
  }
}

/**
 * The one function every task-mutating route calls after its own write
 * succeeds (routes/tasks.ts) — best-effort and this NEVER throws, so a
 * Google failure (rate limit, network blip, revoked token) can never fail
 * the task write it's attached to (FEATURE_ANALYSIS.md's Phase 3,
 * "Failure policy"). A task that fails here is left `syncState: 'error'`,
 * picked up later by `reconcilePendingCalendarSyncs`.
 */
export async function syncTaskWrite(task: Task): Promise<void> {
  try {
    const board = await loadBoard(task.householdId, task.boardId);
    if (board === null || board.type !== 'tasks') return; // board deleted, or (shouldn't happen) wrong type

    const config = TasksBoardConfigSchema.parse(board.config);
    const wantsSync = task.syncToCalendar ?? config.googleSync.enabled;
    const calendarId = config.googleSync.calendarId;
    const shouldHaveEvent = wantsSync && calendarId !== null && task.status === 'active' && !task.dismissed;

    if (!shouldHaveEvent) {
      if (task.googleEventId !== null && task.googleCalendarId !== null) {
        // Marked pending first — if the Lambda dies mid-delete (timeout,
        // container recycle), the task is left in a state
        // `reconcilePendingCalendarSyncs` will pick back up, rather than
        // silently stuck with a stale 'ok' from whatever it was before.
        await setSyncFields(task, { syncState: 'pending', syncError: null });
        await deleteEvent(task.householdId, task.googleCalendarId, task.googleEventId);
      }
      await setSyncFields(task, { syncState: 'ok', syncError: null, googleEventId: null, googleCalendarId: null });
      return;
    }

    const eventId = deterministicEventId(task.id, task.dueAt);
    await setSyncFields(task, { syncState: 'pending', syncError: null });

    if (task.googleEventId !== null && task.googleEventId !== eventId && task.googleCalendarId !== null) {
      // The occurrence changed (e.g. a recurring task was just completed,
      // moving dueAt forward) — retire the previous occurrence's event.
      // Best-effort within the best-effort: losing this cleanup leaves one
      // stale past event in Google, not a broken sync going forward.
      await deleteEvent(task.householdId, task.googleCalendarId, task.googleEventId).catch(() => {});
    }

    await upsertEvent(task.householdId, calendarId, eventId, task);
    await setSyncFields(task, { syncState: 'ok', syncError: null, googleEventId: eventId, googleCalendarId: calendarId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`calendar sync failed for task ${task.id}`, err);
    await setSyncFields(task, { syncState: 'error', syncError: message.slice(0, 500) }).catch((setErr) => {
      console.error(`also failed to record sync error for task ${task.id}`, setErr);
    });
  }
}

/**
 * For a task that has already been deleted from DynamoDB — routes/tasks.ts
 * loads the task *before* deleting it (purely to have this data), then
 * calls this afterward. Never throws; there is no task row left to record
 * an error state on, so a failure here just leaves one orphaned event in
 * Google rather than anything worse.
 */
export async function syncTaskDeletion(task: Pick<Task, 'householdId' | 'googleEventId' | 'googleCalendarId' | 'id'>): Promise<void> {
  if (task.googleEventId === null || task.googleCalendarId === null) return;
  try {
    await deleteEvent(task.householdId, task.googleCalendarId, task.googleEventId);
  } catch (err) {
    console.error(`failed to delete the calendar event for deleted task ${task.id}`, err);
  }
}

async function scanAllPages(params: ScanCommandInput): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient().send(new ScanCommand({ ...params, ExclusiveStartKey: lastEvaluatedKey }));
    items.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey !== undefined);
  return items;
}

/**
 * Retries every task left `pending`/`error` by a previous best-effort sync
 * attempt — meant to be called from the existing hourly reminder sweep
 * (FEATURE_ANALYSIS.md's Phase 3: "rides on the existing hourly EventBridge
 * rule ... no new schedule, no new Lambda"), in its own isolated try/catch
 * there so a failure here can never affect email delivery.
 *
 * A table Scan, not a query against a dedicated index — this app's scale
 * (a household's worth of tasks) makes that acceptable, and every
 * non-task item in the table lacks a `syncState` attribute at all, so the
 * filter excludes them for free rather than needing a type check.
 */
export async function reconcilePendingCalendarSyncs(): Promise<{ retried: number }> {
  const items = await scanAllPages({
    TableName: tableName(),
    FilterExpression: 'syncState IN (:pending, :error)',
    ExpressionAttributeValues: { ':pending': 'pending', ':error': 'error' },
  });

  let retried = 0;
  for (const item of items) {
    try {
      await syncTaskWrite(fromItem(item));
      retried += 1;
    } catch (err) {
      // syncTaskWrite already catches everything it can — reaching here
      // means something broke outside that (e.g. fromItem itself), which
      // must not stop the rest of the reconciliation batch.
      console.error('reconciliation failed for one item', err);
    }
  }
  return { retried };
}
