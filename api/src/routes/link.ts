import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, LinkDocSchema, UpdateLinkDocSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { loadBoard } from '../db/boards.js';
import { loadLinkDoc, saveLinkDoc } from '../db/link.js';

export interface LinkDb {
  loadBoard: typeof loadBoard;
  loadLinkDoc: typeof loadLinkDoc;
  saveLinkDoc: typeof saveLinkDoc;
}

export const defaultLinkDb: LinkDb = { loadBoard, loadLinkDoc, saveLinkDoc };

const params = z.object({ hid: IdSchema, bid: IdSchema });

const getRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards/{bid}/link',
  security: [{ Bearer: [] }],
  request: { params },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ link: LinkDocSchema }) } }, description: 'The board\'s link' },
    404: { description: 'Board not found or not a link board' },
  },
});

const putRoute = createRoute({
  method: 'put',
  path: '/v1/households/{hid}/boards/{bid}/link',
  security: [{ Bearer: [] }],
  request: { params, body: { content: { 'application/json': { schema: UpdateLinkDocSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ link: LinkDocSchema }) } }, description: 'Saved' },
    404: { description: 'Board not found or not a link board' },
  },
});

async function requireLinkBoard(db: LinkDb, hid: string, bid: string): Promise<void> {
  const board = await db.loadBoard(hid, bid);
  if (board === null || board.type !== 'link') {
    throw new ApiError(404, 'not_found', 'Not found');
  }
}

export function registerLinkRoutes(app: OpenAPIHono<AuthedEnv>, db: LinkDb): void {
  app.openapi(getRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireLinkBoard(db, hid, bid);
    return c.json({ link: await db.loadLinkDoc(hid, bid) }, 200);
  });

  app.openapi(putRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    await requireLinkBoard(db, hid, bid);
    const { url, icon } = c.req.valid('json');
    const link = await db.saveLinkDoc(hid, bid, url, icon);
    return c.json({ link }, 200);
  });
}
