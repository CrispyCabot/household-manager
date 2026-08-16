# Phase 2 — Tasks Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the first board type — recurring tasks that nag until completed, with the recurrence-anchor and lead-time behavior from the spec.

**Architecture:** A self-contained module under `packages/shared/src/boards/tasks/` (schemas, recurrence math, registration) and `api/src/routes/tasks.ts` / `app/src/boards/tasks/` mirror it on each side. Nothing in Phase 1's household/board core changes — this phase proves the plugin seam works by using it.

**Tech Stack:** Same as Phase 1 — Hono + `@hono/zod-openapi`, Zod, DynamoDB, React + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-16-household-manager-design.md` §6

## Global Constraints

- **Prerequisite:** Phase 1 complete and deployed — this plan adds routes to an existing `createApp()` and UI to an existing registry.
- **No test cases** — per `PRACTICES.md`. The recurrence arithmetic (Task 1) is the one place the spec's own Verification section flags as worth a second look later; still no tests now unless asked.
- Same `.use()` (`:param`) vs. `createRoute` (`{param}`) path-syntax split as Phase 1 — see that plan's Global Constraints if this is unfamiliar.

**Design note — resolving spec §6's "Becomes due" mechanism:** the spec describes tasks becoming notifiable "at `dueAt - leadTimeDays`" without specifying what actor performs that transition. Nothing in DynamoDB fires at a future timestamp on its own, so this plan resolves it concretely: `notifyAfter` (and the mirrored `GSI1PK`/`GSI1SK`) are written **proactively, at creation and at every reschedule**, set to that future nag-start moment — not deferred until the moment arrives. The Phase 3 scheduler's `GSI1SK <= now` query is what turns an already-stored future timestamp into "actionable now"; no separate activation step or scan is needed. This is consistent with — and is what makes concrete — the spec's Lifecycle bullet that Complete "rewrit[es] the GSI1 keys for the next cycle."

A second, related resolution: the **in-app alert list is independent of `notifyAfter`/GSI1 entirely.** Per spec §6, snooze and dismiss both explicitly leave "the in-app alert stays" — so `notifyAfter`/GSI1 govern *external* delivery pacing only (Phase 3's concern). The in-app alerts endpoint (Task 3) instead computes "is this nagging right now" live, from `dueAt`, `leadTimeDays`, and `status`, on every read.

---

### Task 1: `packages/shared` — task schemas, recurrence math, board-type registration

**Files:**
- Create: `packages/shared/src/boards/tasks/schemas.ts`, `packages/shared/src/boards/tasks/recurrence.ts`, `packages/shared/src/boards/tasks/index.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `IdSchema` (Phase 1 Task 2); `registerBoardType` (Phase 1 Task 2).
- Produces: `Task`, `Recurrence`, `RecurrenceUnit`, `RecurrenceAnchor`, `NotifyPrefs` types and their Zod schemas; `CreateTaskSchema`, `UpdateTaskSchema`, `SnoozeTaskSchema`; `nextOccurrence(fromIso, recurrence): string`. Registers board type `"tasks"`.

- [ ] **Step 1: `packages/shared/src/boards/tasks/schemas.ts`**

```ts
import { z } from 'zod';
import { IdSchema } from '../../ids.js';

export const RecurrenceUnitSchema = z.enum(['day', 'week', 'month', 'year']);
export type RecurrenceUnit = z.infer<typeof RecurrenceUnitSchema>;

/**
 * 'completion' reschedules from the day the task was finished — the chore
 * example (dog cleaned 8/10 -> next due 11/10). 'schedule' reschedules from
 * the ORIGINAL due date, so a fixed obligation paid late does not drift
 * (spec §6).
 */
export const RecurrenceAnchorSchema = z.enum(['completion', 'schedule']);
export type RecurrenceAnchor = z.infer<typeof RecurrenceAnchorSchema>;

export const RecurrenceSchema = z.object({
  every: z.number().int().positive(),
  unit: RecurrenceUnitSchema,
  anchor: RecurrenceAnchorSchema,
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const NotifyPrefsSchema = z.object({
  inApp: z.boolean().default(true),
  email: z.boolean().default(true),
});
export type NotifyPrefs = z.infer<typeof NotifyPrefsSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  boardId: IdSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  dueAt: z.string(),
  recurrence: RecurrenceSchema.nullable(),
  leadTimeDays: z.number().int().nonnegative().default(0),
  notify: NotifyPrefsSchema,
  status: z.enum(['active', 'completed']),
  /** Set by snooze; governs external delivery pacing only — see this plan's design note. */
  snoozedUntil: z.string().nullable(),
  dismissed: z.boolean(),
  notifyAfter: z.string().nullable(),
  lastCompletedAt: z.string().nullable(),
  lastCompletedBy: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().nonnegative(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  dueAt: z.string(),
  recurrence: RecurrenceSchema.nullable().default(null),
  leadTimeDays: z.number().int().nonnegative().default(0),
  notify: NotifyPrefsSchema.default({ inApp: true, email: true }),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = CreateTaskSchema.extend({
  /** The version the client last read. A mismatch means someone else wrote. */
  version: z.number().int().nonnegative(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const SnoozeTaskSchema = z.object({
  hours: z.number().positive().max(24 * 30).default(24),
});
export type SnoozeTaskInput = z.infer<typeof SnoozeTaskSchema>;
```

- [ ] **Step 2: `packages/shared/src/boards/tasks/recurrence.ts`**

```ts
import type { Recurrence } from './schemas.js';

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Adds whole months, clamping to the last day of the resulting month rather
 * than overflowing into the next one — 1/31 plus one month is 2/28 (2/29 in
 * a leap year), never 3/3. Setting the date to 1 before shifting the month
 * avoids JS Date's own month-overflow behavior from ever kicking in.
 */
function addMonthsClampedUtc(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfResultMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfResultMonth));
  return d;
}

/** The next occurrence, `recurrence.every` `recurrence.unit`s after `fromIso`. */
export function nextOccurrence(fromIso: string, recurrence: Recurrence): string {
  const from = new Date(fromIso);
  switch (recurrence.unit) {
    case 'day':
      return addDaysUtc(from, recurrence.every).toISOString();
    case 'week':
      return addDaysUtc(from, recurrence.every * 7).toISOString();
    case 'month':
      return addMonthsClampedUtc(from, recurrence.every).toISOString();
    case 'year':
      return addMonthsClampedUtc(from, recurrence.every * 12).toISOString();
  }
}

/** When nagging should begin: `leadTimeDays` before `dueAt`. Used both to write `notifyAfter` and to evaluate live alerts. */
export function nagStart(dueAt: string, leadTimeDays: number): string {
  const d = new Date(dueAt);
  d.setUTCDate(d.getUTCDate() - leadTimeDays);
  return d.toISOString();
}
```

- [ ] **Step 3: `packages/shared/src/boards/tasks/index.ts`**

```ts
import { z } from 'zod';
import { registerBoardType } from '../../boards.js';

export * from './schemas.js';
export * from './recurrence.js';

// Side effect, at module load: this is the one place "tasks" becomes a real
// board type. The core (households, generic boards) never imports this
// module — only this file's own presence in the app's dependency graph
// (via packages/shared/src/index.ts, and the app-side registry module in
// Task 4) is what activates it.
registerBoardType({
  id: 'tasks',
  displayName: 'Tasks',
  icon: '✅',
  configSchema: z.object({}),
});
```

- [ ] **Step 4: Wire into `packages/shared/src/index.ts`**

```ts
export * from './ids.js';
export * from './keys.js';
export * from './boards.js';
export * from './schemas.js';
export * from './boards/tasks/index.js';
```

- [ ] **Step 5: Verify**

```bash
npx tsc -p packages/shared/tsconfig.json --noEmit
```
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/boards packages/shared/src/index.ts
git commit -m "feat(shared): tasks board type — schemas, recurrence math, registration"
```

---

### Task 2: `api` — task persistence

**Files:**
- Create: `api/src/db/tasks.ts`

**Interfaces:**
- Consumes: `boardSk`, `householdPk` (`@hhm/shared`); `nextOccurrence`, `nagStart` (`@hhm/shared`); `docClient`, `tableName` (Phase 1 Task 7).
- Produces: `VersionConflictError`; `createTask`, `listTasksForBoard`, `loadTask`, `listAlertsForHousehold`, `updateTask`, `completeTask`, `snoozeTask`, `dismissTask`, `deleteTask`.

- [ ] **Step 1: `api/src/db/tasks.ts`**

```ts
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
```

- [ ] **Step 2: Verify**

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/tasks.ts
git commit -m "feat(api): task persistence — CRUD, complete/snooze/dismiss, alerts"
```

---

### Task 3: `api` — task and alert routes

**Files:**
- Create: `api/src/routes/tasks.ts`, `api/src/routes/alerts.ts`
- Modify: `api/src/app.ts`

**Interfaces:**
- Consumes: Task 2's db functions; `loadBoard` (Phase 1 Task 9); `AuthedEnv`.
- Produces: `TaskDb`, `defaultTaskDb`, `registerTaskRoutes`; `AlertDb`, `defaultAlertDb`, `registerAlertRoutes`; both mounted in `createApp()`.

- [ ] **Step 1: `api/src/routes/tasks.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CreateTaskSchema, IdSchema, SnoozeTaskSchema, TaskSchema, UpdateTaskSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { loadBoard } from '../db/boards.js';
import {
  VersionConflictError,
  completeTask,
  createTask,
  deleteTask,
  dismissTask,
  listTasksForBoard,
  snoozeTask,
  updateTask,
} from '../db/tasks.js';

export interface TaskDb {
  loadBoard: typeof loadBoard;
  createTask: typeof createTask;
  listTasksForBoard: typeof listTasksForBoard;
  updateTask: typeof updateTask;
  completeTask: typeof completeTask;
  snoozeTask: typeof snoozeTask;
  dismissTask: typeof dismissTask;
  deleteTask: typeof deleteTask;
}

export const defaultTaskDb: TaskDb = {
  loadBoard,
  createTask,
  listTasksForBoard,
  updateTask,
  completeTask,
  snoozeTask,
  dismissTask,
  deleteTask,
};

const params = z.object({ hid: IdSchema, bid: IdSchema });
const taskParams = z.object({ hid: IdSchema, bid: IdSchema, tid: IdSchema });

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards/{bid}/tasks',
  security: [{ Bearer: [] }],
  request: { params },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ tasks: z.array(TaskSchema) }) } }, description: 'Tasks on this board' },
    404: { description: 'Board not found or not a tasks board' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards/{bid}/tasks',
  security: [{ Bearer: [] }],
  request: { params, body: { content: { 'application/json': { schema: CreateTaskSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ task: TaskSchema }) } }, description: 'Created' },
    404: { description: 'Board not found or not a tasks board' },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}/boards/{bid}/tasks/{tid}',
  security: [{ Bearer: [] }],
  request: { params: taskParams, body: { content: { 'application/json': { schema: UpdateTaskSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ task: TaskSchema }) } }, description: 'Updated' },
    409: { description: 'Version conflict' },
  },
});

const completeRoute = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards/{bid}/tasks/{tid}/complete',
  security: [{ Bearer: [] }],
  request: { params: taskParams },
  responses: { 200: { content: { 'application/json': { schema: z.object({ task: TaskSchema }) } }, description: 'Completed and rescheduled' } },
});

const snoozeRoute = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards/{bid}/tasks/{tid}/snooze',
  security: [{ Bearer: [] }],
  request: { params: taskParams, body: { content: { 'application/json': { schema: SnoozeTaskSchema } } } },
  responses: { 200: { content: { 'application/json': { schema: z.object({ task: TaskSchema }) } }, description: 'Snoozed' } },
});

const dismissRoute = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards/{bid}/tasks/{tid}/dismiss',
  security: [{ Bearer: [] }],
  request: { params: taskParams },
  responses: { 200: { content: { 'application/json': { schema: z.object({ task: TaskSchema }) } }, description: 'External delivery silenced' } },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/boards/{bid}/tasks/{tid}',
  security: [{ Bearer: [] }],
  request: { params: taskParams },
  responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
});

/** Every route here is scoped to a board that must exist and be a tasks board — checked once, consistently. */
async function requireTasksBoard(db: TaskDb, hid: string, bid: string): Promise<void> {
  const board = await db.loadBoard(hid, bid);
  if (board === null || board.type !== 'tasks') {
    throw new ApiError(404, 'not_found', 'Not found');
  }
}

export function registerTaskRoutes(app: OpenAPIHono<AuthedEnv>, db: TaskDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    return c.json({ tasks: await db.listTasksForBoard(hid, bid) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    const { sub } = c.get('user');
    const body = c.req.valid('json');
    const task = await db.createTask({ householdId: hid, boardId: bid, createdBy: sub, task: body });
    return c.json({ task }, 201);
  });

  app.openapi(patchRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      const task = await db.updateTask(hid, bid, tid, body);
      return c.json({ task }, 200);
    } catch (err) {
      if (err instanceof VersionConflictError) throw new ApiError(409, 'version_conflict', err.message);
      throw err;
    }
  });

  app.openapi(completeRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    const { sub } = c.get('user');
    const task = await db.completeTask(hid, bid, tid, sub);
    return c.json({ task }, 200);
  });

  app.openapi(snoozeRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    const { hours } = c.req.valid('json');
    const task = await db.snoozeTask(hid, bid, tid, hours);
    return c.json({ task }, 200);
  });

  app.openapi(dismissRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    const task = await db.dismissTask(hid, bid, tid);
    return c.json({ task }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    const deleted = await db.deleteTask(hid, bid, tid);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });
}
```

- [ ] **Step 2: `api/src/routes/alerts.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, TaskSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { listAlertsForHousehold } from '../db/tasks.js';

export interface AlertDb {
  listAlertsForHousehold: typeof listAlertsForHousehold;
}

export const defaultAlertDb: AlertDb = { listAlertsForHousehold };

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/alerts',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ alerts: z.array(TaskSchema) }) } }, description: 'Everything currently nagging, across every board' },
  },
});

export function registerAlertRoutes(app: OpenAPIHono<AuthedEnv>, db: AlertDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid } = c.req.valid('param');
    return c.json({ alerts: await db.listAlertsForHousehold(hid) }, 200);
  });
}
```

- [ ] **Step 3: Wire into `api/src/app.ts`**

```ts
// add alongside the other route imports:
import { type TaskDb, defaultTaskDb, registerTaskRoutes } from './routes/tasks.js';
import { type AlertDb, defaultAlertDb, registerAlertRoutes } from './routes/alerts.js';
```

```ts
// add to AppDeps:
  taskDb?: TaskDb;
  alertDb?: AlertDb;
```

```ts
// add alongside the other registerXRoutes calls, inside createApp():
  registerTaskRoutes(app, deps.taskDb ?? defaultTaskDb);
  registerAlertRoutes(app, deps.alertDb ?? defaultAlertDb);
```

No new `.use()` entries are needed — `/v1/households/:hid/*` (registered in Phase 1) already covers `.../boards/{bid}/tasks/...` and `.../alerts`.

- [ ] **Step 4: Verify**

```bash
npx tsc -p api/tsconfig.json --noEmit
cd infrastructure && npx cdk synth --quiet
```
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/tasks.ts api/src/routes/alerts.ts api/src/app.ts
git commit -m "feat(api): task and household-alert routes"
```

---

### Task 4: `app` — tasks board UI

**Files:**
- Create: `app/src/boards/tasks/index.tsx`, `app/src/boards/tasks/TaskCard.tsx`, `app/src/boards/tasks/TaskForm.tsx`, `app/src/boards/tasks/TasksBoardPage.tsx`
- Modify: `app/src/api/queries.ts`

**Interfaces:**
- Consumes: `boardTypeUi`/`registerBoardTypeUi` (Phase 1 Task 16); `apiFetch` (Phase 1 Task 15).
- Produces: registers `"tasks"` in the app-side board registry; `useTasks`, `useCreateTask`, `useUpdateTask`, `useCompleteTask`, `useSnoozeTask`, `useDismissTask`, `useDeleteTask`, `useAlerts`.

- [ ] **Step 1: Add task hooks to `app/src/api/queries.ts`**

```ts
// add to the imports:
import type { CreateTaskInput, SnoozeTaskInput, Task, UpdateTaskInput } from '@hhm/shared';
```

```ts
// append:
export const taskQueryKeys = {
  tasks: (hid: string, bid: string) => ['households', hid, 'boards', bid, 'tasks'] as const,
  alerts: (hid: string) => ['households', hid, 'alerts'] as const,
};

export function useTasks(householdId: string, boardId: string) {
  const token = useToken();
  return useQuery({
    queryKey: taskQueryKeys.tasks(householdId, boardId),
    enabled: token !== null,
    queryFn: () => apiFetch<{ tasks: Task[] }>(`/v1/households/${householdId}/boards/${boardId}/tasks`, token!),
  });
}

export function useAlerts(householdId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: taskQueryKeys.alerts(householdId ?? ''),
    enabled: token !== null && householdId !== null,
    // Alerts drive the persistent nag banner, so they should not sit on the
    // 30s default staleTime — a completed task should disappear promptly.
    staleTime: 0,
    queryFn: () => apiFetch<{ alerts: Task[] }>(`/v1/households/${householdId}/alerts`, token!),
  });
}

function invalidateTaskQueries(qc: ReturnType<typeof useQueryClient>, hid: string, bid: string) {
  void qc.invalidateQueries({ queryKey: taskQueryKeys.tasks(hid, bid) });
  void qc.invalidateQueries({ queryKey: taskQueryKeys.alerts(hid) });
}

export function useCreateTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useUpdateTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateTaskInput }) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}`, required(token), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useCompleteTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}/complete`, required(token), { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useSnoozeTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: SnoozeTaskInput }) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}/snooze`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useDismissTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}/dismiss`, required(token), { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useDeleteTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<void>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}`, required(token), { method: 'DELETE' }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}
```

- [ ] **Step 2: `app/src/boards/tasks/TaskCard.tsx`** — one row inside the board page (not the household-dashboard card, which is `index.tsx`'s `Card` below)

```tsx
import type { Task } from '@hhm/shared';
import { useCompleteTask, useDeleteTask } from '../../api/queries.js';

export function TaskRow({ householdId, task }: { householdId: string; task: Task }) {
  const complete = useCompleteTask(householdId, task.boardId);
  const remove = useDeleteTask(householdId, task.boardId);

  return (
    <div className="task-row">
      <div>
        <strong>{task.title}</strong>
        {task.description !== '' && <p className="task-row__desc">{task.description}</p>}
        <span className="task-row__due">Due {new Date(task.dueAt).toLocaleDateString()}</span>
        {task.recurrence !== null && (
          <span className="task-row__recur">
            {' '}
            · every {task.recurrence.every} {task.recurrence.unit}
            {task.recurrence.every > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="task-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(task.id)} disabled={complete.isPending}>
          Complete
        </button>
        <button type="button" className="btn-small" onClick={() => remove.mutate(task.id)} disabled={remove.isPending}>
          Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `app/src/boards/tasks/TaskForm.tsx`**

```tsx
import { useState } from 'react';
import type { CreateTaskInput, RecurrenceUnit } from '@hhm/shared';
import { useCreateTask } from '../../api/queries.js';

export function TaskForm({ householdId, boardId }: { householdId: string; boardId: string }) {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [recurs, setRecurs] = useState(false);
  const [every, setEvery] = useState(1);
  const [unit, setUnit] = useState<RecurrenceUnit>('month');
  const [anchor, setAnchor] = useState<'completion' | 'schedule'>('completion');
  const [leadTimeDays, setLeadTimeDays] = useState(0);
  const createTask = useCreateTask(householdId, boardId);

  return (
    <form
      className="task-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '' || dueAt === '') return;
        const input: CreateTaskInput = {
          title: title.trim(),
          description: '',
          dueAt: new Date(dueAt).toISOString(),
          recurrence: recurs ? { every, unit, anchor } : null,
          leadTimeDays,
          notify: { inApp: true, email: true },
        };
        createTask.mutate(input, {
          onSuccess: () => {
            setTitle('');
            setDueAt('');
          },
        });
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Clean the dog" />
      <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      <label>
        <input type="checkbox" checked={recurs} onChange={(e) => setRecurs(e.target.checked)} />
        Repeats
      </label>
      {recurs && (
        <div className="task-form__recur">
          every
          <input
            type="number"
            min={1}
            value={every}
            onChange={(e) => setEvery(Math.max(1, Number(e.target.value)))}
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}>
            <option value="day">day(s)</option>
            <option value="week">week(s)</option>
            <option value="month">month(s)</option>
            <option value="year">year(s)</option>
          </select>
          <select value={anchor} onChange={(e) => setAnchor(e.target.value as 'completion' | 'schedule')}>
            <option value="completion">from when it's done</option>
            <option value="schedule">from the original date</option>
          </select>
        </div>
      )}
      <label>
        Start nagging
        <input
          type="number"
          min={0}
          value={leadTimeDays}
          onChange={(e) => setLeadTimeDays(Math.max(0, Number(e.target.value)))}
        />
        days early
      </label>
      <button type="submit" className="btn-primary" disabled={createTask.isPending}>
        Add task
      </button>
    </form>
  );
}
```

- [ ] **Step 4: `app/src/boards/tasks/TasksBoardPage.tsx`**

```tsx
import type { Board } from '@hhm/shared';
import { useTasks } from '../../api/queries.js';
import { TaskForm } from './TaskForm.js';
import { TaskRow } from './TaskCard.js';

export function TasksBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useTasks(board.householdId, board.id);

  return (
    <div className="page">
      <h1>{board.title}</h1>
      <TaskForm householdId={board.householdId} boardId={board.id} />
      {isLoading && <p className="notice">Loading…</p>}
      {!isLoading && (data?.tasks.length ?? 0) === 0 && <div className="empty">No tasks yet.</div>}
      <div className="task-list">
        {(data?.tasks ?? []).map((task) => (
          <TaskRow key={task.id} householdId={board.householdId} task={task} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `app/src/boards/tasks/index.tsx`** — the household-dashboard `Card`, and registration

```tsx
import { Link } from 'react-router';
import type { Board } from '@hhm/shared';
import { useTasks } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { TasksBoardPage } from './TasksBoardPage.js';

function Card({ board }: { board: Board }) {
  const { data } = useTasks(board.householdId, board.id);
  const count = data?.tasks.length ?? 0;

  return (
    <Link to={`/households/${board.householdId}/boards/${board.id}`} className="card">
      <strong>{board.title}</strong>
      <p>{count} task{count === 1 ? '' : 's'}</p>
    </Link>
  );
}

registerBoardTypeUi('tasks', { Card, Page: TasksBoardPage });
```

- [ ] **Step 6: Import the module for its side effect, in `app/src/main.tsx`**

```ts
// add near the top, with the other imports:
import './boards/tasks/index.js';
```

- [ ] **Step 7: Verify**

```bash
npx tsc -p app/tsconfig.json --noEmit
```
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add app/src/api/queries.ts app/src/boards/tasks app/src/main.tsx
git commit -m "feat(app): tasks board UI — card, form, board page, registration"
```

---

### Task 5: `app` — alert banner, add-board, board page route

**Files:**
- Create: `app/src/components/AlertBanner.tsx`, `app/src/components/AddBoardButton.tsx`, `app/src/routes/BoardPage.tsx`
- Modify: `app/src/routes/Home.tsx`, `app/src/main.tsx`

**Interfaces:**
- Consumes: `useAlerts`, `useCompleteTask`, `useSnoozeTask`, `useDismissTask` (Task 4); `boardTypeUi` (Phase 1 Task 16); `useHouseholds`/`useBoards` (Phase 1 Task 15).

- [ ] **Step 1: `app/src/components/AlertBanner.tsx`** — "everything currently nagging" (spec §10: shown first on the household page)

```tsx
import { useAlerts, useCompleteTask, useDismissTask, useSnoozeTask } from '../api/queries.js';

export function AlertBanner({ householdId }: { householdId: string }) {
  const { data, isLoading } = useAlerts(householdId);
  if (isLoading || (data?.alerts.length ?? 0) === 0) return null;

  return (
    <div className="alert-banner">
      {data!.alerts.map((task) => (
        <AlertRow key={task.id} householdId={householdId} taskId={task.id} boardId={task.boardId} title={task.title} />
      ))}
    </div>
  );
}

function AlertRow({
  householdId,
  boardId,
  taskId,
  title,
}: {
  householdId: string;
  boardId: string;
  taskId: string;
  title: string;
}) {
  const complete = useCompleteTask(householdId, boardId);
  const snooze = useSnoozeTask(householdId, boardId);
  const dismiss = useDismissTask(householdId, boardId);

  return (
    <div className="alert-row" role="alert">
      <span>{title} is due</span>
      <div className="alert-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(taskId)}>
          Done
        </button>
        <button type="button" className="btn-small" onClick={() => snooze.mutate({ taskId, input: { hours: 24 } })}>
          Snooze 24h
        </button>
        <button type="button" className="btn-small" onClick={() => dismiss.mutate(taskId)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `app/src/components/AddBoardButton.tsx`**

```tsx
import { useState } from 'react';
import { useCreateBoard } from '../api/queries.js';

/** In phase 1 the registry was empty, so there was nothing to add — this is the first point creating a board means anything. */
const AVAILABLE_TYPES = [{ type: 'tasks', label: 'Tasks' }];

export function AddBoardButton({ householdId }: { householdId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const createBoard = useCreateBoard(householdId);

  if (!open) {
    return (
      <button type="button" className="btn-small" onClick={() => setOpen(true)}>
        + Add board
      </button>
    );
  }

  return (
    <form
      className="add-board"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '') return;
        createBoard.mutate({ type: 'tasks', title: title.trim() }, { onSuccess: () => setOpen(false) });
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Board title" autoFocus />
      <button type="submit" className="btn-primary" disabled={createBoard.isPending}>
        Add {AVAILABLE_TYPES[0]!.label}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: `app/src/routes/BoardPage.tsx`** — resolves `:boardId` from the already-cached boards list (no new fetch needed)

```tsx
import { useParams } from 'react-router';
import { useBoards } from '../api/queries.js';
import { boardTypeUi } from '../boards/registry.js';

export function BoardPage() {
  const { householdId, boardId } = useParams<{ householdId: string; boardId: string }>();
  const { data, isLoading } = useBoards(householdId ?? null);

  if (isLoading) return <p className="notice">Loading…</p>;

  const board = data?.boards.find((b) => b.id === boardId);
  if (board === undefined) return <p className="notice">Board not found.</p>;

  const ui = boardTypeUi(board.type);
  if (ui === undefined) return <p className="notice">Unknown board type "{board.type}".</p>;

  return <ui.Page board={board} />;
}
```

- [ ] **Step 4: Wire `AlertBanner` and `AddBoardButton` into `app/src/routes/Home.tsx`**

```ts
// add to the imports:
import { AlertBanner } from '../components/AlertBanner.js';
import { AddBoardButton } from '../components/AddBoardButton.js';
```

In the `Home` component's final `return` (the branch that renders `<BoardGrid householdId={activeId} />`), add the banner above the grid and the button below it:

```tsx
  return (
    <div className="page">
      {activeId !== null && (
        <>
          <AlertBanner householdId={activeId} />
          <BoardGrid householdId={activeId} />
          <AddBoardButton householdId={activeId} />
        </>
      )}
      {selectedHouseholdId === null && activeId !== null && (
        <span style={{ display: 'none' }} ref={() => setSelectedHouseholdId(activeId)} />
      )}
    </div>
  );
```

- [ ] **Step 5: Add the board-page route in `app/src/main.tsx`**

```ts
// add to the imports:
import { BoardPage } from './routes/BoardPage.js';
```

```tsx
// inside <Routes>, alongside the existing routes:
        <Route path="/households/:householdId/boards/:boardId" element={<BoardPage />} />
```

- [ ] **Step 6: A minimal style pass for the new elements** — append to `app/src/styles.css`

```css
.alert-banner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.alert-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #fff3cd;
  border: 1px solid #ffe08a;
  border-radius: 8px;
  gap: 12px;
}

.alert-row__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.task-form,
.add-board {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px;
  margin: 12px 0;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.task-form input,
.task-form select,
.add-board input {
  font-size: 15px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 6px;
}

.task-form__recur {
  display: flex;
  gap: 6px;
  align-items: center;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  gap: 12px;
}

.task-row__desc,
.task-row__due,
.task-row__recur {
  color: #666;
  font-size: 13px;
}

.task-row__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
```

- [ ] **Step 7: Verify**

```bash
npx tsc -p app/tsconfig.json --noEmit
npm run build --workspace @hhm/app
```
Expected: both exit 0.

- [ ] **Step 8: Manual smoke test** (requires Phase 1's deploy already live)

```bash
npm run dev:env
npm run dev
```
Open `http://localhost:5173`: add a "Tasks" board, create a task due today, confirm it appears in the alert banner, click Complete, confirm a recurring task's due date advances and a non-recurring one disappears from the banner.

- [ ] **Step 9: Commit**

```bash
git add app/src/components/AlertBanner.tsx app/src/components/AddBoardButton.tsx app/src/routes/BoardPage.tsx app/src/routes/Home.tsx app/src/main.tsx app/src/styles.css
git commit -m "feat(app): alert banner, add-board flow, board page route"
```

---

### Task 6: Deploy and verify end to end

**Files:** none — deploy only.

- [ ] **Step 1: OPERATOR — push and let Actions deploy**

```bash
git push origin main
gh run watch
```

- [ ] **Step 2: Verify live**

Open the deployed URL (`https://household-manager.chrisbridewell.dev` if Phase 1's Task 18 Step 7 already ran, otherwise the CloudFront URL). Repeat Task 5 Step 8's smoke test against the real deployment. Confirm `GET /openapi.json` on the deployed API includes the new `/v1/households/{hid}/boards/{bid}/tasks*` and `/v1/households/{hid}/alerts` paths.

---

## Rollback

Every task here is additive to Phase 1's working app — no existing route, table item shape, or UI path is modified, only extended. A `git revert` of any task's commit is safe. If a live deploy misbehaves, reverting and redeploying removes the tasks board type from the registry; boards already created with `type: "tasks"` become unrenderable (`BoardPage` shows "Unknown board type") until the revert is undone, but no data is lost — the items remain in DynamoDB.
