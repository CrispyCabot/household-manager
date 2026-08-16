import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { BoardSchema, CreateBoardSchema, IdSchema, UpdateBoardSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { createBoard, deleteBoard, listBoards, loadBoard, renameBoard } from '../db/boards.js';

export interface BoardDb {
  createBoard: typeof createBoard;
  listBoards: typeof listBoards;
  loadBoard: typeof loadBoard;
  renameBoard: typeof renameBoard;
  deleteBoard: typeof deleteBoard;
}

export const defaultBoardDb: BoardDb = { createBoard, listBoards, loadBoard, renameBoard, deleteBoard };

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
    const { hid } = c.req.valid('param');
    const body = c.req.valid('json');
    const board = await db.createBoard({ householdId: hid, type: body.type, title: body.title });
    return c.json({ board }, 201);
  });

  app.openapi(patchRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    const { title } = c.req.valid('json');
    const board = await db.renameBoard(hid, bid, title);
    if (board === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ board }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    const deleted = await db.deleteBoard(hid, bid);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });
}
