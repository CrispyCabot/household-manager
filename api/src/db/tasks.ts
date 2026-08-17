import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { boardSk, householdPk, nagStart, nextOccurrence } from '@hhm/shared';
import type { CreateTaskInput, Task, UpdateTaskInput } from '@hhm/shared';
import { docClient, tableName } from './client.js';

function taskSk(boardId: string, taskId: string): string {
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

function fromItem(i: Record<string, unknown>): Task {
  return {
    id: String(i.id),
    householdId: String(i.householdId),
    boardId: String(i.boardId),
    title: String(i.title),
    description: String(i.description ?? ''),
    dueAt: String(i.dueAt),
    recurrence: (i.recurrence as Task['recurrence']) ?? null,
    leadTimeDays: Number(i.leadTimeDays ?? 0),
    notify: (i.notify as Task['notify']) ?? { inApp: true, email: true },
    status: i.status === 'completed' ? 'completed' : 'active',
    snoozedUntil: (i.snoozedUntil as string | null | undefined) ?? null,
    dismissed: Boolean(i.dismissed),
    notifyAfter: (i.notifyAfter as string | null | undefined) ?? null,
    lastCompletedAt: (i.lastCompletedAt as string | null | undefined) ?? null,
    lastCompletedBy: (i.lastCompletedBy as string | null | undefined) ?? null,
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
  const notifyAfter = nagStart(input.task.dueAt, input.task.leadTimeDays);

  const task: Task = {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    boardId: input.boardId,
    title: input.task.title,
    description: input.task.description,
    dueAt: input.task.dueAt,
    recurrence: input.task.recurrence,
    leadTimeDays: input.task.leadTimeDays,
    notify: input.task.notify,
    status: 'active',
    snoozedUntil: null,
    dismissed: false,
    notifyAfter,
    lastCompletedAt: null,
    lastCompletedBy: null,
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
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': `${boardSk(boardId)}#TASK#` },
    }),
  );
  // A task's own item has 4 '#'-delimited SK segments; its completion
  // records (…#TASK#<id>#DONE#<ts>) have 6, so this excludes history.
  return (result.Items ?? []).filter((i) => String(i.SK).split('#').length === 4).map(fromItem);
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
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'BOARD#' },
    }),
  );
  const now = new Date();
  return (result.Items ?? [])
    .filter((i) => String(i.SK).split('#').length === 4 && i.status === 'active')
    .map(fromItem)
    .filter((t) => new Date(nagStart(t.dueAt, t.leadTimeDays)) <= now);
}

export async function updateTask(
  householdId: string,
  boardId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const existing = await loadTask(householdId, boardId, taskId);
  if (existing === null) throw new Error(`task ${taskId} does not exist`);

  const now = new Date().toISOString();
  // A dismissed task's next notifyAfter is not restored by an ordinary edit
  // — only completing it (which always clears dismissed) re-arms delivery.
  const notifyAfter = existing.dismissed ? null : nagStart(input.dueAt, input.leadTimeDays);

  try {
    const result = await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) },
        UpdateExpression:
          'SET title = :title, description = :description, dueAt = :dueAt, recurrence = :recurrence, ' +
          'leadTimeDays = :leadTimeDays, notify = :notify, updatedAt = :now, version = :next, notifyAfter = :notifyAfter' +
          (notifyAfter === null ? ' REMOVE GSI1PK, GSI1SK' : ', GSI1PK = :gsi1pk, GSI1SK = :gsi1sk'),
        ConditionExpression: 'version = :expected',
        ExpressionAttributeValues: {
          ':title': input.title,
          ':description': input.description,
          ':dueAt': input.dueAt,
          ':recurrence': input.recurrence,
          ':leadTimeDays': input.leadTimeDays,
          ':notify': input.notify,
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
  if (existing === null) throw new Error(`task ${taskId} does not exist`);

  const now = new Date().toISOString();
  const nextDueAt =
    existing.recurrence === null
      ? null
      : nextOccurrence(existing.recurrence.anchor === 'completion' ? now : existing.dueAt, existing.recurrence);
  const notifyAfter = nextDueAt === null ? null : nagStart(nextDueAt, existing.leadTimeDays);

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

export async function snoozeTask(householdId: string, boardId: string, taskId: string, hours: number): Promise<Task> {
  const notifyAfter = new Date(Date.now() + hours * 3_600_000).toISOString();
  const result = await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) },
      UpdateExpression: 'SET snoozedUntil = :until, notifyAfter = :notifyAfter, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, updatedAt = :now',
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
}

/** Silences external delivery only — the in-app alert is unaffected (design note above). */
export async function dismissTask(householdId: string, boardId: string, taskId: string): Promise<Task> {
  const result = await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) },
      UpdateExpression: 'SET dismissed = :true, updatedAt = :now REMOVE GSI1PK, GSI1SK, notifyAfter',
      ExpressionAttributeValues: { ':true': true, ':now': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return fromItem(result.Attributes ?? {});
}

export async function deleteTask(householdId: string, boardId: string, taskId: string): Promise<boolean> {
  const existing = await loadTask(householdId, boardId, taskId);
  if (existing === null) return false;
  await docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: taskSk(boardId, taskId) } }));
  return true;
}
