import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { BoardSchema, CreateBoardSchema, IdSchema, ReorderBoardsSchema, UpdateBoardConfigSchema, UpdateBoardSchema, boardType } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import {
  InvalidOrderError,
  createBoard,
  deleteBoard,
  listBoards,
  loadBoard,
  renameBoard,
  reorderBoards,
  updateBoardConfig,
} from '../db/boards.js';

export interface BoardDb {
  createBoard: typeof createBoard;
  listBoards: typeof listBoards;
  loadBoard: typeof loadBoard;
  renameBoard: typeof renameBoard;
  reorderBoards: typeof reorderBoards;
  deleteBoard: typeof deleteBoard;
  updateBoardConfig: typeof updateBoardConfig;
}

export const defaultBoardDb: BoardDb = {
  createBoard,
  listBoards,
  loadBoard,
  renameBoard,
  reorderBoards,
  deleteBoard,
  updateBoardConfig,
};

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ boards: z.array(BoardSchema) }) } }, description: 'Boards, in display order' },
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards/{bid}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema, bid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ board: BoardSchema }) } }, description: 'A single board — lets a client (e.g. a future native app deep-linking to one board) fetch it without listing every board first' },
    404: { description: 'Not found' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema }),
    body: { content: { 'application/json': { schema: CreateBoardSchema } } },
  },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ board: BoardSchema }) } }, description: 'Created' },
    400: { description: 'Unknown board type' },
  },
});

const reorderRoute = createRoute({
  method: 'put',
  path: '/v1/households/{hid}/boards/order',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema }),
    body: { content: { 'application/json': { schema: ReorderBoardsSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ boards: z.array(BoardSchema) }) } }, description: 'Reordered' },
    400: { description: 'boardIds is not exactly the current board set' },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}/boards/{bid}',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema, bid: IdSchema }),
    body: { content: { 'application/json': { schema: UpdateBoardSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ board: BoardSchema }) } }, description: 'Updated' },
    404: { description: 'Not found' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/boards/{bid}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema, bid: IdSchema }) },
  responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
});

const configRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}/boards/{bid}/config',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema, bid: IdSchema }),
    body: { content: { 'application/json': { schema: UpdateBoardConfigSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ board: BoardSchema }) } }, description: 'Updated' },
    400: { description: "Config doesn't match this board type's schema" },
    404: { description: 'Not found' },
  },
});

export function registerBoardRoutes(app: OpenAPIHono<AuthedEnv>, db: BoardDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid } = c.req.valid('param');
    return c.json({ boards: await db.listBoards(hid) }, 200);
  });

  app.openapi(getRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    const board = await db.loadBoard(hid, bid);
    if (board === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ board }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    const body = c.req.valid('json');
    const board = await db.createBoard({ householdId: hid, type: body.type, title: body.title });
    return c.json({ board }, 201);
  });

  app.openapi(reorderRoute, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    const { boardIds } = c.req.valid('json');
    try {
      const boards = await db.reorderBoards(hid, boardIds);
      return c.json({ boards }, 200);
    } catch (err) {
      if (err instanceof InvalidOrderError) throw new ApiError(400, 'invalid_order', err.message);
      throw err;
    }
  });

  app.openapi(patchRoute, async (c) => {
    requireUser(c);
    const { hid, bid } = c.req.valid('param');
    const { title } = c.req.valid('json');
    const board = await db.renameBoard(hid, bid, title);
    if (board === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ board }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    requireUser(c);
    const { hid, bid } = c.req.valid('param');
    const deleted = await db.deleteBoard(hid, bid);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });

  app.openapi(configRoute, async (c) => {
    requireUser(c);
    const { hid, bid } = c.req.valid('param');
    const body = c.req.valid('json');

    const existing = await db.loadBoard(hid, bid);
    if (existing === null) throw new ApiError(404, 'not_found', 'Not found');

    // The core board layer never knows what any type's config looks like
    // (spec §5) — this is the one place that does, dispatching to whichever
    // type this specific board happens to be.
    const definition = boardType(existing.type);
    const parsed = definition?.configSchema.safeParse(body);
    if (parsed === undefined || !parsed.success) {
      throw new ApiError(400, 'invalid_config', "Config doesn't match this board type's schema");
    }

    const board = await db.updateBoardConfig(hid, bid, parsed.data as Record<string, unknown>);
    if (board === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ board }, 200);
  });
}
