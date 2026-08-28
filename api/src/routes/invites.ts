import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CreateInviteSchema, IdSchema, InviteSchema } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { createInvite, listInvites, revokeInvite } from '../db/invites.js';

export interface InviteDb {
  createInvite: typeof createInvite;
  listInvites: typeof listInvites;
  revokeInvite: typeof revokeInvite;
}

export const defaultInviteDb: InviteDb = { createInvite, listInvites, revokeInvite };

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/invites',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ invites: z.array(InviteSchema) }) } }, description: 'Pending invites' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/invites',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema }),
    body: { content: { 'application/json': { schema: CreateInviteSchema } } },
  },
  responses: { 201: { content: { 'application/json': { schema: z.object({ invite: InviteSchema }) } }, description: 'Invited' } },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/invites/{email}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema, email: z.string() }) },
  responses: { 204: { description: 'Revoked' } },
});

export function registerInviteRoutes(app: OpenAPIHono<AuthedEnv>, db: InviteDb): void {
  app.openapi(listRoute, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    return c.json({ invites: await db.listInvites(hid) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    const { email } = c.req.valid('json');
    const invite = await db.createInvite(hid, email);
    return c.json({ invite }, 201);
  });

  app.openapi(deleteRoute, async (c) => {
    requireUser(c);
    const { hid, email } = c.req.valid('param');
    // Path segments are percent-encoded — an invited email like
    // "a+b@example.com" arrives as "a%2Bb%40example.com".
    await db.revokeInvite(hid, decodeURIComponent(email));
    return c.body(null, 204);
  });
}
