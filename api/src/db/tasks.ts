import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { boardSk, householdPk, nagStart, nextOccurrence } from '@hhm/shared';
import type { CreateTaskInput, Task, UpdateTaskInput } from '@hhm/shared';
import { docClient, tableName } from './client.js';

/** Loops on `LastEvaluatedKey` so a partition larger than DynamoDB's 1MB per-Query cap isn't silently truncated. */
export async function queryAllPages(params: QueryCommandInput): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient().send(
      new QueryCommand({ ...params, ExclusiveStartKey: lastEvaluatedKey }),
    );
    items.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey !== undefined);
  return items;
}

export function taskSk(boardId: string, taskId: string): string {
  return `${boardSk(boardId)}#TASK#${taskId}`;
}

function completionSk(boardId: string, taskId: string, completedAt: string): string {
  return `${taskSk(boardId, taskId)}#DONE#${completedAt}`;
}

export class VersionConflictError extends Error {
  constructor() {
    super('The task was modified by someone else');
    this.name = 'VersionConflictError';
  }
}

export class TaskNotFoundError extends Error {
  constructor() {
    super('Task not found');
    this.name = 'TaskNotFoundError';
  }
}

/** Exported for google/taskSync.ts's reconciliation sweep, which reads raw scan results of the same item shape. */
export function fromItem(i: Record<string, unknown>): Task {
  return {
    id: String(i.id),
    householdId: String(i.householdId),
    boardId: String(i.boardId),
    title: String(i.title),
    description: String(i.description ?? ''),
    dueAt: String(i.dueAt),
    recurrence: (i.recurrence as Task['recurrence']) ?? null,
    leadTimeDays: Number(i.leadTimeDays ?? 0),
    notifyTimeOfDay: (i.notifyTimeOfDay as string | null | undefined) ?? null,
    renotifyIntervalHours: (i.renotifyIntervalHours as number | null | undefined) ?? null,
    notify: (i.notify as Task['notify']) ?? { inApp: true, email: true },
    status: i.status === 'completed' ? 'completed' : 'active',
    snoozedUntil: (i.snoozedUntil as string | null | undefined) ?? null,
    dismissed: Boolean(i.dismissed),
    notifyAfter: (i.notifyAfter as string | null | undefined) ?? null,
    lastCompletedAt: (i.lastCompletedAt as string | null | undefined) ?? null,
    lastCompletedBy: (i.lastCompletedBy as string | null | undefined) ?? null,
    syncToCalendar: (i.syncToCalendar as boolean | null | undefined) ?? null,
    googleEventId: (i.googleEventId as string | null | undefined) ?? null,
    googleCalendarId: (i.googleCalendarId as string | null | undefined) ?? null,
    syncState: (i.syncState as Task['syncState'] | undefined) ?? 'ok',
    syncError: (i.syncError as string | null | undefined) ?? null,
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
    version: Number(i.version),
  };
}

export async function createTask(input: {
  householdId: string;
  boardId: string;
  createdBy: string;
  task: CreateTaskInput;
}): Promise<Task> {
  const now = new Date().toISOString();
  const notifyAfter = nagStart(input.task.dueAt, input.task.leadTimeDays, input.task.notifyTimeOfDay);

  const task: Task = {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    boardId: input.boardId,
    title: input.task.title,
    description: input.task.description,
    dueAt: input.task.dueAt,
    recurrence: input.task.recurrence,
    leadTimeDays: input.task.leadTimeDays,
    notifyTimeOfDay: input.task.notifyTimeOfDay,
    renotifyIntervalHours: input.task.renotifyIntervalHours,
    notify: input.task.notify,
    status: 'active',
    snoozedUntil: null,
    dismissed: false,
    notifyAfter,
    lastCompletedAt: null,
    lastCompletedBy: null,
    syncToCalendar: input.task.syncToCalendar,
    googleEventId: null,
    googleCalendarId: null,
    syncState: 'ok',
    syncError: null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  // notifyAfter/GSI1 are written now, proactively, for a moment in the
  // future — see this phase's design note for why nothing writes them later.
  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: householdPk(input.householdId), SK: taskSk(input.boardId, task.id), ...task, GSI1PK: 'DUE', GSI1SK: notifyAfter },
    }),
  );

  return task;
}

export async function listTasksForBoard(householdId: string, boardId: string): Promise<Task[]> {
  const items = await queryAllPages({
    TableName: tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': `${boardSk(boardId)}#TASK#` },
  });
  // A task's own item has 4 '#'-delimited SK segments; its completion
  // records (…#TASK#<id>#DONE#<ts>) have 6, so this excludes history.
  return items.filter((i) => String(i.SK).split('#').length === 4).map(fromItem);
}

export async function loadTask(householdId: string, boardId: string, taskId: string): Promise<Task | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) } }),
  );
  return result.Item === undefined ? null : fromItem(result.Item);
}

/**
 * Everything currently nagging in this household — independent of
 * `notifyAfter`/GSI1/snooze/dismiss, which govern EXTERNAL delivery pacing
 * only. In-app, a task alerts unconditionally from the moment its lead time
 * opens until it is completed (design note above; spec §6).
 */
export async function listAlertsForHousehold(householdId: string): Promise<Task[]> {
  const items = await queryAllPages({
    TableName: tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'BOARD#' },
  });
  const now = new Date();
  return items
    .filter((i) => {
      const parts = String(i.SK).split('#');
      return parts.length === 4 && parts[2] === 'TASK' && i.status === 'active';
    })
    .map(fromItem)
    .filter((t) => new Date(nagStart(t.dueAt, t.leadTimeDays, t.notifyTimeOfDay)) <= now);
}

export async function updateTask(
  householdId: string,
  boardId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const existing = await loadTask(householdId, boardId, taskId);
  if (existing === null) throw new TaskNotFoundError();

  const now = new Date().toISOString();
  // A dismissed task's next notifyAfter is not restored by an ordinary edit
  // — only completing it (which always clears dismissed) re-arms delivery.
  const notifyAfter = existing.dismissed ? null : nagStart(input.dueAt, input.leadTimeDays, input.notifyTimeOfDay);

  try {
    const result = await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) },
        UpdateExpression:
          'SET title = :title, description = :description, dueAt = :dueAt, recurrence = :recurrence, ' +
          'leadTimeDays = :leadTimeDays, notifyTimeOfDay = :notifyTimeOfDay, renotifyIntervalHours = :renotifyIntervalHours, notify = :notify, ' +
          'syncToCalendar = :syncToCalendar, updatedAt = :now, ' +
          'version = :next, notifyAfter = :notifyAfter' +
          (notifyAfter === null ? ' REMOVE GSI1PK, GSI1SK' : ', GSI1PK = :gsi1pk, GSI1SK = :gsi1sk'),
        ConditionExpression: 'version = :expected',
        ExpressionAttributeValues: {
          ':title': input.title,
          ':description': input.description,
          ':dueAt': input.dueAt,
          ':recurrence': input.recurrence,
          ':leadTimeDays': input.leadTimeDays,
          ':notifyTimeOfDay': input.notifyTimeOfDay,
          ':renotifyIntervalHours': input.renotifyIntervalHours,
          ':notify': input.notify,
          ':syncToCalendar': input.syncToCalendar,
          ':now': now,
          ':next': input.version + 1,
          ':expected': input.version,
          ':notifyAfter': notifyAfter,
          ...(notifyAfter === null ? {} : { ':gsi1pk': 'DUE', ':gsi1sk': notifyAfter }),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return fromItem(result.Attributes ?? {});
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      throw new VersionConflictError();
    }
    throw err;
  }
}

/**
 * Appends a completion record and either reschedules (recurring) or retires
 * (one-off) the task. Both writes are one transaction: a completion record
 * must never exist for a task update that did not actually take (e.g. a
 * concurrent edit raced it).
 */
export async function completeTask(householdId: string, boardId: string, taskId: string, completedBy: string): Promise<Task> {
  const existing = await loadTask(householdId, boardId, taskId);
  if (existing === null) throw new TaskNotFoundError();

  const now = new Date().toISOString();
  const nextDueAt =
    existing.recurrence === null
      ? null
      : nextOccurrence(existing.recurrence.anchor === 'completion' ? now : existing.dueAt, existing.recurrence);
  const notifyAfter = nextDueAt === null ? null : nagStart(nextDueAt, existing.leadTimeDays, existing.notifyTimeOfDay);

  try {
    await docClient().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName(),
              Item: { PK: householdPk(householdId), SK: completionSk(boardId, taskId, now), taskId, completedAt: now, completedBy },
            },
          },
          {
            Update: {
              TableName: tableName(),
              Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) },
              UpdateExpression:
                'SET #status = :status, dueAt = :dueAt, snoozedUntil = :null, dismissed = :false, ' +
                'lastCompletedAt = :now, lastCompletedBy = :by, updatedAt = :now, version = :next, notifyAfter = :notifyAfter' +
                (notifyAfter === null ? ' REMOVE GSI1PK, GSI1SK' : ', GSI1PK = :gsi1pk, GSI1SK = :gsi1sk'),
              ConditionExpression: 'version = :expected',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':status': nextDueAt === null ? 'completed' : 'active',
                ':dueAt': nextDueAt ?? existing.dueAt,
                ':null': null,
                ':false': false,
                ':now': now,
                ':by': completedBy,
                ':next': existing.version + 1,
                ':expected': existing.version,
                ':notifyAfter': notifyAfter,
                ...(notifyAfter === null ? {} : { ':gsi1pk': 'DUE', ':gsi1sk': notifyAfter }),
              },
            },
          },
        ],
      }),
    );
  } catch (err) {
    // TransactWriteCommand condition failures surface as
    // TransactionCanceledException, not ConditionalCheckFailedException —
    // that name is only for single-item conditional writes.
    if (err instanceof Error && err.name === 'TransactionCanceledException') {
      throw new VersionConflictError();
    }
    throw err;
  }

  const updated = await loadTask(householdId, boardId, taskId);
  if (updated === null) throw new Error('task disappeared mid-transaction');
  return updated;
}

/**
 * `fromIso` defaults to real wall-clock time, which is what a user-initiated
 * snooze (the API routes) wants. The hourly reminder sweep instead passes
 * its own invocation-start timestamp — see the call site in reminder.ts for
 * why that matters: with an hourly sweep and a 1-hour renotify interval,
 * anchoring to `Date.now()` here (called after that invocation's SES sends
 * complete, ~1s into the run) pushed `notifyAfter` just past the *next*
 * sweep's tick, which made the task miss it and wait for the one after —
 * silently doubling every 1-hour renotify interval to 2 hours.
 */
export async function snoozeTask(
  householdId: string,
  boardId: string,
  taskId: string,
  hours: number,
  fromIso: string = new Date().toISOString(),
): Promise<Task> {
  const notifyAfter = new Date(new Date(fromIso).getTime() + hours * 3_600_000).toISOString();
  try {
    const result = await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) },
        UpdateExpression: 'SET snoozedUntil = :until, notifyAfter = :notifyAfter, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: {
          ':until': notifyAfter,
          ':notifyAfter': notifyAfter,
          ':gsi1pk': 'DUE',
          ':gsi1sk': notifyAfter,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return fromItem(result.Attributes ?? {});
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      throw new TaskNotFoundError();
    }
    throw err;
  }
}

/** Silences external delivery only — the in-app alert is unaffected (design note above). */
export async function dismissTask(householdId: string, boardId: string, taskId: string): Promise<Task> {
  try {
    const result = await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) },
        UpdateExpression: 'SET dismissed = :true, updatedAt = :now REMOVE GSI1PK, GSI1SK, notifyAfter',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':true': true, ':now': new Date().toISOString() },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return fromItem(result.Attributes ?? {});
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      throw new TaskNotFoundError();
    }
    throw err;
  }
}

export async function deleteTask(householdId: string, boardId: string, taskId: string): Promise<boolean> {
  const existing = await loadTask(householdId, boardId, taskId);
  if (existing === null) return false;
  await docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) } }));
  return true;
}
