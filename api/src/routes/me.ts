import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, MeResponseSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { claimInvites } from '../db/invites.js';
import { listHouseholdsForUser } from '../db/households.js';
import { setLastHousehold, upsertProfile } from '../db/profiles.js';

export interface MeDb {
  claimInvites: typeof claimInvites;
  listHouseholdsForUser: typeof listHouseholdsForUser;
  upsertProfile: typeof upsertProfile;
  setLastHousehold: typeof setLastHousehold;
}

export const defaultMeDb: MeDb = { claimInvites, listHouseholdsForUser, upsertProfile, setLastHousehold };

const getMeRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  security: [{ Bearer: [] }],
  responses: {
    200: { content: { 'application/json': { schema: MeResponseSchema } }, description: 'The caller, their households, and their last-visited one' },
  },
});

const putLastHouseholdRoute = createRoute({
  method: 'put',
  path: '/v1/me/last-household',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ householdId: IdSchema }) } } } },
  responses: { 204: { description: 'Remembered' } },
});

export function registerMeRoutes(app: OpenAPIHono<AuthedEnv>, db: MeDb): void {
  app.openapi(getMeRoute, async (c) => {
    const { sub, email } = c.get('user');
    // Must run before households are listed — otherwise an invite claimed
    // moments ago would not show up until the NEXT request.
    await db.claimInvites(sub, email);
    const profile = await db.upsertProfile(sub, email);
    const households = await db.listHouseholdsForUser(sub);
    return c.json({ sub, email: profile.email, lastHouseholdId: profile.lastHouseholdId, households }, 200);
  });

  app.openapi(putLastHouseholdRoute, async (c) => {
    const { sub } = c.get('user');
    const { householdId } = c.req.valid('json');
    await db.setLastHousehold(sub, householdId);
    return c.body(null, 204);
  });
}
