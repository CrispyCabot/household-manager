import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CreateTaskSchema, IdSchema, SnoozeTaskSchema, TaskSchema, UpdateTaskSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
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
    const { sub } = c.get('user');
    const body = c.req.valid('json');
    const task = await db.createTask({ householdId: hid, boardId: bid, createdBy: sub, task: body });
    return c.json({ task }, 201);
  });

  app.openapi(patchRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    const body = c.req.valid('json');
    try {
      const task = await db.updateTask(hid, bid, tid, body);
      return c.json({ task }, 200);
    } catch (err) {
      if (err instanceof VersionConflictError) throw new ApiError(409, 'version_conflict', err.message);
      if (err instanceof TaskNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(completeRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    const { sub } = c.get('user');
    try {
      const task = await db.completeTask(hid, bid, tid, sub);
      return c.json({ task }, 200);
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
      return c.json({ task }, 200);
    } catch (err) {
      if (err instanceof TaskNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid, bid, tid } = c.req.valid('param');
    await requireTasksBoard(db, hid, bid);
    const deleted = await db.deleteTask(hid, bid, tid);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });
}
