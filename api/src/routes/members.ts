import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, MemberSchema } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import { listMembers, loadHousehold, removeMember } from '../db/households.js';

export interface MemberDb {
  listMembers: typeof listMembers;
  loadHousehold: typeof loadHousehold;
  removeMember: typeof removeMember;
}

export const defaultMemberDb: MemberDb = { listMembers, loadHousehold, removeMember };

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/members',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ members: z.array(MemberSchema) }) } }, description: 'Members' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/members/{sub}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema, sub: z.string() }) },
  responses: { 204: { description: 'Removed' }, 403: { description: 'The creator cannot be removed' } },
});

export function registerMemberRoutes(app: OpenAPIHono<AuthedEnv>, db: MemberDb): void {
  app.openapi(listRoute, async (c) => {
    // User-only: not in the device authorization table (FEATURE_ANALYSIS.md)
    // — a wall dashboard sitting in a hallway has no need to see member
    // emails.
    requireUser(c);
    const { hid } = c.req.valid('param');
    return c.json({ members: await db.listMembers(hid) }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    requireUser(c);
    const { hid, sub } = c.req.valid('param');
    const household = await db.loadHousehold(hid);
    // A member removing themselves IS "leaving" — same endpoint, same rule:
    // the creator cannot be removed, since deletion rights are tied to that
    // identity and a household must always have someone who can delete it.
    if (household !== null && household.createdBy === sub) {
      throw new ApiError(403, 'forbidden', 'The creator cannot be removed from the household');
    }
    await db.removeMember(hid, sub);
    return c.body(null, 204);
  });
}
