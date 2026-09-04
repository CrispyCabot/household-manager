import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CreateTaskSchema, IdSchema, SnoozeTaskSchema, TaskSchema, UpdateTaskSchema } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import { loadBoard } from '../db/boards.js';
import {
  TaskNotFoundError,
  VersionConflictError,
  completeTask,
  createTask,
  deleteTask,
  dismissTask,
  listTasksForBoard,
  loadTask,
  snoozeTask,
  updateTask,
} from '../db/tasks.js';
import { syncTaskDeletion, syncTaskWrite } from '../google/taskSync.js';

export interface TaskDb {
  loadBoard: typeof loadBoard;
  loadTask: typeof loadTask;
  createTask: typeof createTask;
  listTasksForBoard: typeof listTasksForBoard;
  updateTask: typeof updateTask;
  completeTask: typeof completeTask;
  snoozeTask: typeof snoozeTask;
  dismissTask: typeof dismissTask;
  deleteTask: typeof deleteTask;
  syncTaskWrite: typeof syncTaskWrite;
  syncTaskDeletion: typeof syncTaskDeletion;
}

export const defaultTaskDb: TaskDb = {
  loadBoard,
  loadTask,
  createTask,
  listTasksForBoard,
  updateTask,
  completeTask,
  snoozeTask,
  dismissTask,
  deleteTask,
  syncTaskWrite,
  syncTaskDeletion,
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
  responses: {
    200: { content: { 'application/json': { schema: z.object({ task: TaskSchema }) } }, description: 'Completed and rescheduled' },
    409: { description: 'Version conflict' },
  },
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
    const { sub } = requireUser(c);
    const body = c.req.valid('json');
    const task = await db.createTask({ householdId: hid, boardId: bid, createdBy: sub, task: body });
    // Best-effort, inline — see google/taskSync.ts's own doc comment on why
    // this can never fail this write; a Google outage must not stop a
    // household from creating a task. Re-read afterward so the response
    // reflects syncTaskWrite's own updates (syncState/googleEventId), not
    // the pre-sync snapshot.
    await db.syncTaskWrite(task);
    const synced = (await db.loadTask(hid, bid, task.id)) ?? task;
    return c.json({ task: synced }, 201);
  });

  app.openapi(patchRoute, async (c) => {
    requireUser(c);
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    const body = c.req.valid('json');
    try {
      const task = await db.updateTask(hid, bid, tid, body);
      await db.syncTaskWrite(task);
      const synced = (await db.loadTask(hid, bid, tid)) ?? task;
      return c.json({ task: synced }, 200);
    } catch (err) {
      if (err instanceof VersionConflictError) throw new ApiError(409, 'version_conflict', err.message);
      if (err instanceof TaskNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(completeRoute, async (c) => {
    // Device-eligible — a wall dashboard is a touchscreen and may complete
    // tasks (FEATURE_ANALYSIS.md's device authorization table). It has no
    // Cognito `sub` to attribute completion to, so it's labeled by device
    // id instead — distinguishable from a user's `sub` by the "device:"
    // prefix, which no Cognito sub ever has.
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    const principal = c.get('user');
    const completedBy = principal.kind === 'user' ? principal.sub : `device:${principal.deviceId}`;
    try {
      const task = await db.completeTask(hid, bid, tid, completedBy);
      await db.syncTaskWrite(task);
      const synced = (await db.loadTask(hid, bid, tid)) ?? task;
      return c.json({ task: synced }, 200);
    } catch (err) {
      if (err instanceof VersionConflictError) throw new ApiError(409, 'version_conflict', err.message);
      if (err instanceof TaskNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(snoozeRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    const { hours } = c.req.valid('json');
    try {
      const task = await db.snoozeTask(hid, bid, tid, hours);
      return c.json({ task }, 200);
    } catch (err) {
      if (err instanceof TaskNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(dismissRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    try {
      const task = await db.dismissTask(hid, bid, tid);
      // Dismissing takes the task out of external delivery, and Google
      // sync follows the same "active and not dismissed" rule as the event
      // it mirrors — see google/taskSync.ts's shouldHaveEvent.
      await db.syncTaskWrite(task);
      const synced = (await db.loadTask(hid, bid, tid)) ?? task;
      return c.json({ task: synced }, 200);
    } catch (err) {
      if (err instanceof TaskNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(deleteRoute, async (c) => {
    requireUser(c);
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    // Loaded before deleting, purely to know what Google event (if any) to
    // clean up afterward — the task row itself won't exist to read that
    // from once deleteTask returns.
    const existing = await db.loadTask(hid, bid, tid);
    const deleted = await db.deleteTask(hid, bid, tid);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    if (existing !== null) await db.syncTaskDeletion(existing);
    return c.body(null, 204);
  });
}
