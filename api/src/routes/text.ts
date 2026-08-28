import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, TextDocSchema, UpdateTextDocSchema } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import { loadBoard } from '../db/boards.js';
import { loadTextDoc, saveTextDoc } from '../db/text.js';

export interface TextDb {
  loadBoard: typeof loadBoard;
  loadTextDoc: typeof loadTextDoc;
  saveTextDoc: typeof saveTextDoc;
}

export const defaultTextDb: TextDb = { loadBoard, loadTextDoc, saveTextDoc };

const params = z.object({ hid: IdSchema, bid: IdSchema });

const getRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards/{bid}/doc',
  security: [{ Bearer: [] }],
  request: { params },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ doc: TextDocSchema }) } }, description: 'The board\'s document' },
    404: { description: 'Board not found or not a text board' },
  },
});

const putRoute = createRoute({
  method: 'put',
  path: '/v1/households/{hid}/boards/{bid}/doc',
  security: [{ Bearer: [] }],
  request: { params, body: { content: { 'application/json': { schema: UpdateTextDocSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ doc: TextDocSchema }) } }, description: 'Saved' },
    404: { description: 'Board not found or not a text board' },
  },
});

async function requireTextBoard(db: TextDb, hid: string, bid: string): Promise<void> {
  const board = await db.loadBoard(hid, bid);
  if (board === null || board.type !== 'text') {
    throw new ApiError(404, 'not_found', 'Not found');
  }
}

export function registerTextRoutes(app: OpenAPIHono<AuthedEnv>, db: TextDb): void {
  app.openapi(getRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireTextBoard(db, hid, bid);
    return c.json({ doc: await db.loadTextDoc(hid, bid) }, 200);
  });

  app.openapi(putRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireTextBoard(db, hid, bid);
    const { sub } = requireUser(c);
    const { blocks } = c.req.valid('json');
    const doc = await db.saveTextDoc(hid, bid, blocks, sub);
    return c.json({ doc }, 200);
  });
}
