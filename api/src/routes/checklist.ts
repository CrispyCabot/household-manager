import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { ChecklistItemSchema, CreateChecklistItemSchema, IdSchema, UpdateChecklistItemSchema } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import { loadBoard } from '../db/boards.js';
import {
  ChecklistItemNotFoundError,
  createChecklistItem,
  deleteChecklistItem,
  listChecklistItems,
  renameChecklistItem,
  toggleChecklistItem,
} from '../db/checklist.js';

export interface ChecklistDb {
  loadBoard: typeof loadBoard;
  createChecklistItem: typeof createChecklistItem;
  listChecklistItems: typeof listChecklistItems;
  renameChecklistItem: typeof renameChecklistItem;
  toggleChecklistItem: typeof toggleChecklistItem;
  deleteChecklistItem: typeof deleteChecklistItem;
}

export const defaultChecklistDb: ChecklistDb = {
  loadBoard,
  createChecklistItem,
  listChecklistItems,
  renameChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
};

const params = z.object({ hid: IdSchema, bid: IdSchema });
const itemParams = z.object({ hid: IdSchema, bid: IdSchema, iid: IdSchema });

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards/{bid}/items',
  security: [{ Bearer: [] }],
  request: { params },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ items: z.array(ChecklistItemSchema) }) } }, description: 'Items on this checklist' },
    404: { description: 'Board not found or not a checklist board' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards/{bid}/items',
  security: [{ Bearer: [] }],
  request: { params, body: { content: { 'application/json': { schema: CreateChecklistItemSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ item: ChecklistItemSchema }) } }, description: 'Created' },
    404: { description: 'Board not found or not a checklist board' },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}/boards/{bid}/items/{iid}',
  security: [{ Bearer: [] }],
  request: { params: itemParams, body: { content: { 'application/json': { schema: UpdateChecklistItemSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ item: ChecklistItemSchema }) } }, description: 'Updated' },
    404: { description: 'Not found' },
  },
});

const toggleRoute = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards/{bid}/items/{iid}/toggle',
  security: [{ Bearer: [] }],
  request: { params: itemParams },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ item: ChecklistItemSchema }) } }, description: 'Checked state flipped' },
    404: { description: 'Not found' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/boards/{bid}/items/{iid}',
  security: [{ Bearer: [] }],
  request: { params: itemParams },
  responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
});

/** Every route here is scoped to a board that must exist and be a checklist board — checked once, consistently. */
async function requireChecklistBoard(db: ChecklistDb, hid: string, bid: string): Promise<void> {
  const board = await db.loadBoard(hid, bid);
  if (board === null || board.type !== 'checklist') {
    throw new ApiError(404, 'not_found', 'Not found');
  }
}

export function registerChecklistRoutes(app: OpenAPIHono<AuthedEnv>, db: ChecklistDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireChecklistBoard(db, hid, bid);
    return c.json({ items: await db.listChecklistItems(hid, bid) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireChecklistBoard(db, hid, bid);
    const { sub } = requireUser(c);
    const body = c.req.valid('json');
    const item = await db.createChecklistItem({ householdId: hid, boardId: bid, createdBy: sub, item: body });
    return c.json({ item }, 201);
  });

  app.openapi(patchRoute, async (c) => {
    requireUser(c);
    const { hid, bid, iid } = c.req.valid('param');
    await requireChecklistBoard(db, hid, bid);
    const body = c.req.valid('json');
    try {
      const item = await db.renameChecklistItem(hid, bid, iid, body);
      return c.json({ item }, 200);
    } catch (err) {
      if (err instanceof ChecklistItemNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(toggleRoute, async (c) => {
    // Device-eligible — a wall dashboard is a touchscreen, and checking off
    // a shopping-list item is closer to "acting on" existing content than
    // "authoring" it (see FEATURE_ANALYSIS.md's device authorization table).
    const { hid, bid, iid } = c.req.valid('param');
    await requireChecklistBoard(db, hid, bid);
    try {
      const item = await db.toggleChecklistItem(hid, bid, iid);
      return c.json({ item }, 200);
    } catch (err) {
      if (err instanceof ChecklistItemNotFoundError) throw new ApiError(404, 'not_found', 'Not found');
      throw err;
    }
  });

  app.openapi(deleteRoute, async (c) => {
    requireUser(c);
    const { hid, bid, iid } = c.req.valid('param');
    await requireChecklistBoard(db, hid, bid);
    const deleted = await db.deleteChecklistItem(hid, bid, iid);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });
}
