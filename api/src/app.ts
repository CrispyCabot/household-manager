import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { type AuthedEnv, createAuthMiddleware, principalVerifier, type PrincipalVerifier } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { requireMembership } from './middleware/household.js';
import { isMember } from './db/households.js';
import { type MeDb, defaultMeDb, registerMeRoutes } from './routes/me.js';
import { type HouseholdDb, defaultHouseholdDb, registerHouseholdRoutes } from './routes/households.js';
import { type InviteDb, defaultInviteDb, registerInviteRoutes } from './routes/invites.js';
import { type MemberDb, defaultMemberDb, registerMemberRoutes } from './routes/members.js';
import { type BoardDb, defaultBoardDb, registerBoardRoutes } from './routes/boards.js';
import { type TaskDb, defaultTaskDb, registerTaskRoutes } from './routes/tasks.js';
import { type AlertDb, defaultAlertDb, registerAlertRoutes } from './routes/alerts.js';
import { type NotifyDb, defaultNotifyDb, registerNotifyRoutes } from './routes/notify.js';
import { type ChecklistDb, defaultChecklistDb, registerChecklistRoutes } from './routes/checklist.js';
import { type TextDb, defaultTextDb, registerTextRoutes } from './routes/text.js';
import { type LinkDb, defaultLinkDb, registerLinkRoutes } from './routes/link.js';
import { type ActionDb, defaultActionDb, registerActionRoutes } from './routes/actions.js';
import {
  type DeviceDb,
  defaultDeviceDb,
  registerDeviceManagementRoutes,
  registerDevicePairingRoutes,
  registerDeviceSelfRoutes,
} from './routes/devices.js';
import { type GoogleDb, defaultGoogleDb, registerGoogleRoutes } from './routes/google.js';
import { type CalendarDb, defaultCalendarDb, registerCalendarRoutes } from './routes/calendar.js';

export interface AppDeps {
  /** Injected in local/manual testing; production builds the real Cognito-or-device verifier lazily. */
  verify?: PrincipalVerifier;
  /** Injected in tests so `/v1/households/:hid/*` routes don't need a real table — see `isMember`. */
  checkMembership?: typeof isMember;
  meDb?: MeDb;
  householdDb?: HouseholdDb;
  inviteDb?: InviteDb;
  memberDb?: MemberDb;
  boardDb?: BoardDb;
  taskDb?: TaskDb;
  alertDb?: AlertDb;
  notifyDb?: NotifyDb;
  checklistDb?: ChecklistDb;
  textDb?: TextDb;
  linkDb?: LinkDb;
  actionDb?: ActionDb;
  deviceDb?: DeviceDb;
  googleDb?: GoogleDb;
  calendarDb?: CalendarDb;
}

export function createApp(deps: AppDeps = {}): OpenAPIHono<AuthedEnv> {
  const app = new OpenAPIHono<AuthedEnv>({
    // @hono/zod-openapi validates request bodies/params BEFORE the handler
    // runs, so a Zod failure never reaches errorHandler's ZodError branch —
    // this hook is where it is caught instead, kept in the same shape.
    defaultHook: (result, c) => {
      if (!result.success) {
        console.error('validation error', result.error.issues);
        return c.json({ error: { code: 'validation_error', message: 'Invalid request' } }, 400);
      }
    },
  });

  app.use('*', cors({
    origin: (origin) => process.env.WEB_ORIGIN ?? origin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  const verify = deps.verify ?? principalVerifier();
  const requireAuth = createAuthMiddleware(verify);

  // NOTE: `.use()` is plain Hono, so its path uses Hono's `:param` syntax —
  // `createRoute({ path })` inside the route modules above uses OpenAPI's
  // `{param}` syntax instead. They are not interchangeable.
  app.use('/v1/me', requireAuth);
  app.use('/v1/me/*', requireAuth);
  app.use('/v1/households', requireAuth);
  const checkMembership = deps.checkMembership ?? isMember;
  app.use('/v1/households/:hid', requireAuth, requireMembership(checkMembership));
  app.use('/v1/households/:hid/*', requireAuth, requireMembership(checkMembership));
  // A device authenticates but belongs to no `:hid` route — its household
  // comes from its own token, not a path segment — so this is `requireAuth`
  // alone, no `requireMembership()`.
  app.use('/v1/devices/me', requireAuth);

  registerMeRoutes(app, deps.meDb ?? defaultMeDb);
  registerHouseholdRoutes(app, deps.householdDb ?? defaultHouseholdDb);
  registerInviteRoutes(app, deps.inviteDb ?? defaultInviteDb);
  registerMemberRoutes(app, deps.memberDb ?? defaultMemberDb);
  registerBoardRoutes(app, deps.boardDb ?? defaultBoardDb);
  registerTaskRoutes(app, deps.taskDb ?? defaultTaskDb);
  registerAlertRoutes(app, deps.alertDb ?? defaultAlertDb);
  registerNotifyRoutes(app, deps.notifyDb ?? defaultNotifyDb);
  registerChecklistRoutes(app, deps.checklistDb ?? defaultChecklistDb);
  registerTextRoutes(app, deps.textDb ?? defaultTextDb);
  registerLinkRoutes(app, deps.linkDb ?? defaultLinkDb);
  registerDeviceManagementRoutes(app, deps.deviceDb ?? defaultDeviceDb);
  registerDeviceSelfRoutes(app, deps.deviceDb ?? defaultDeviceDb);
  // Deliberately unauthenticated — mounted outside every requireAuth
  // `.use()` above, same as routes/actions.ts's own /actions/* routes
  // (see that file's doc comment): a device has no session yet when it
  // asks for a pairing code or exchanges its secret for a token.
  registerDevicePairingRoutes(app, deps.deviceDb ?? defaultDeviceDb);
  registerCalendarRoutes(app, deps.calendarDb ?? defaultCalendarDb);
  // registerGoogleRoutes also mounts /v1/google/callback, unauthenticated
  // for the same reason as the pairing routes above — Google redirects the
  // browser there directly, with no bearer token attached; the signed
  // `state` param is what authorizes it (google/state.ts).
  registerGoogleRoutes(app, deps.googleDb ?? defaultGoogleDb);
  registerActionRoutes(app, deps.actionDb ?? defaultActionDb);

  // Every route sets `security: [{ Bearer: [] }]`; OpenAPI 3.1 requires the
  // referenced scheme to actually be declared, or the document is invalid
  // (codegen breaks, and /docs has no way to let a user authenticate).
  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  // The API-first contract (spec's Goals): a machine-readable document a
  // future native client can generate against without touching this repo.
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'household-manager API', version: '1.0.0' },
  });
  // Human-browsable view of the same document — spec §7 lists both.
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  app.notFound(notFound);
  app.onError(errorHandler);

  return app;
}
