import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { GoogleCalendarSchema, GoogleConnectionSchema, IdSchema } from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import { GoogleReauthRequiredError } from '../google/accessToken.js';
import {
  OAuthCallbackError,
  buildGoogleAuthUrl,
  completeGoogleOAuth,
  disconnectGoogle,
  getGoogleConnection,
  listHouseholdCalendars,
} from '../google/service.js';

export interface GoogleDb {
  buildGoogleAuthUrl: typeof buildGoogleAuthUrl;
  completeGoogleOAuth: typeof completeGoogleOAuth;
  getGoogleConnection: typeof getGoogleConnection;
  disconnectGoogle: typeof disconnectGoogle;
  listHouseholdCalendars: typeof listHouseholdCalendars;
}

export const defaultGoogleDb: GoogleDb = {
  buildGoogleAuthUrl,
  completeGoogleOAuth,
  getGoogleConnection,
  disconnectGoogle,
  listHouseholdCalendars,
};

function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? '';
}

const hidParams = z.object({ hid: IdSchema });

const authUrlRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/google/auth-url',
  security: [{ Bearer: [] }],
  request: { params: hidParams },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ url: z.string() }) } }, description: "Google's consent URL — redirect the browser there" },
  },
});

const connectionRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/google',
  security: [{ Bearer: [] }],
  request: { params: hidParams },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ connection: GoogleConnectionSchema.nullable() }) } },
      description: 'null if this household has never connected a Google account',
    },
  },
});

const disconnectRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/google',
  security: [{ Bearer: [] }],
  request: { params: hidParams },
  responses: { 204: { description: 'Disconnected' } },
});

const calendarsRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/google/calendars',
  security: [{ Bearer: [] }],
  request: { params: hidParams },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ calendars: z.array(GoogleCalendarSchema) }) } }, description: 'For the calendar board config picker' },
    409: { description: 'Not connected, or needs reconnecting' },
  },
});

export function registerGoogleRoutes(app: OpenAPIHono<AuthedEnv>, db: GoogleDb = defaultGoogleDb): void {
  app.openapi(authUrlRoute, async (c) => {
    const { sub } = requireUser(c);
    const { hid } = c.req.valid('param');
    const url = await db.buildGoogleAuthUrl(hid, sub);
    return c.json({ url }, 200);
  });

  app.openapi(connectionRoute, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    const connection = await db.getGoogleConnection(hid);
    return c.json({ connection }, 200);
  });

  app.openapi(disconnectRoute, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    await db.disconnectGoogle(hid);
    return c.body(null, 204);
  });

  app.openapi(calendarsRoute, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    try {
      const calendars = await db.listHouseholdCalendars(hid);
      return c.json({ calendars }, 200);
    } catch (err) {
      if (err instanceof GoogleReauthRequiredError) {
        throw new ApiError(409, 'needs_reauth', 'Reconnect this household’s Google account');
      }
      throw err;
    }
  });

  // Unauthenticated by necessity — Google redirects the browser here
  // directly, with no bearer token attached. The signed `state` param
  // (google/state.ts) is what authorizes this, the same shape as
  // routes/actions.ts's signed action tokens.
  app.get('/v1/google/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error !== undefined) {
      return c.redirect(`${webOrigin()}/?google=denied`);
    }
    if (code === undefined || state === undefined) {
      return c.redirect(`${webOrigin()}/?google=error`);
    }

    try {
      const householdId = await completeGoogleOAuth({ code, state });
      return c.redirect(`${webOrigin()}/households/${householdId}/settings?google=connected`);
    } catch (err) {
      if (err instanceof OAuthCallbackError) {
        console.error('Google OAuth callback failed', err.message);
        const target = err.redirectHouseholdId === null ? '/' : `/households/${err.redirectHouseholdId}/settings`;
        return c.redirect(`${webOrigin()}${target}?google=error`);
      }
      throw err;
    }
  });
}
