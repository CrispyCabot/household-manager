import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, MeResponseSchema, NotificationChannelSchema, PushTokenSchema, ThemeSchema } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { claimInvites } from '../db/invites.js';
import { listHouseholdsForUser } from '../db/households.js';
import { setLastHousehold, setNotifyVia, setTheme, upsertProfile } from '../db/profiles.js';
import { removePushToken, savePushToken } from '../db/pushTokens.js';

export interface MeDb {
  claimInvites: typeof claimInvites;
  listHouseholdsForUser: typeof listHouseholdsForUser;
  upsertProfile: typeof upsertProfile;
  setLastHousehold: typeof setLastHousehold;
  setTheme: typeof setTheme;
  setNotifyVia: typeof setNotifyVia;
  savePushToken: typeof savePushToken;
  removePushToken: typeof removePushToken;
}

export const defaultMeDb: MeDb = {
  claimInvites,
  listHouseholdsForUser,
  upsertProfile,
  setLastHousehold,
  setTheme,
  setNotifyVia,
  savePushToken,
  removePushToken,
};

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

const putThemeRoute = createRoute({
  method: 'put',
  path: '/v1/me/theme',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ theme: ThemeSchema.nullable() }) } } } },
  responses: { 204: { description: 'Saved' } },
});

const putNotificationsRoute = createRoute({
  method: 'put',
  path: '/v1/me/notifications',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ via: NotificationChannelSchema }) } } } },
  responses: { 204: { description: 'Saved' } },
});

const pushTokenBody = { content: { 'application/json': { schema: z.object({ token: PushTokenSchema }) } } };

const putPushTokenRoute = createRoute({
  method: 'put',
  path: '/v1/me/push-token',
  security: [{ Bearer: [] }],
  request: { body: pushTokenBody },
  responses: { 204: { description: 'This phone now receives task reminders' } },
});

const deletePushTokenRoute = createRoute({
  method: 'delete',
  path: '/v1/me/push-token',
  security: [{ Bearer: [] }],
  request: { body: pushTokenBody },
  responses: { 204: { description: 'This phone no longer receives task reminders' } },
});

export function registerMeRoutes(app: OpenAPIHono<AuthedEnv>, db: MeDb): void {
  app.openapi(getMeRoute, async (c) => {
    const { sub, email } = requireUser(c);
    // Must run before households are listed — otherwise an invite claimed
    // moments ago would not show up until the NEXT request.
    await db.claimInvites(sub, email);
    const profile = await db.upsertProfile(sub, email);
    const households = await db.listHouseholdsForUser(sub);
    return c.json(
      {
        sub,
        email: profile.email,
        lastHouseholdId: profile.lastHouseholdId,
        theme: profile.theme,
        notifyVia: profile.notifyVia,
        households,
      },
      200,
    );
  });

  app.openapi(putLastHouseholdRoute, async (c) => {
    const { sub } = requireUser(c);
    const { householdId } = c.req.valid('json');
    await db.setLastHousehold(sub, householdId);
    return c.body(null, 204);
  });

  app.openapi(putThemeRoute, async (c) => {
    const { sub } = requireUser(c);
    const { theme } = c.req.valid('json');
    await db.setTheme(sub, theme);
    return c.body(null, 204);
  });

  app.openapi(putNotificationsRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.setNotifyVia(sub, c.req.valid('json').via);
    return c.body(null, 204);
  });

  app.openapi(putPushTokenRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.savePushToken(sub, c.req.valid('json').token, new Date().toISOString());
    return c.body(null, 204);
  });

  app.openapi(deletePushTokenRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.removePushToken(sub, c.req.valid('json').token);
    return c.body(null, 204);
  });
}
