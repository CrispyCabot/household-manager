import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { type AuthedEnv, cognitoVerifier, createAuthMiddleware, type TokenVerifier } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { requireMembership } from './middleware/household.js';
import { type MeDb, defaultMeDb, registerMeRoutes } from './routes/me.js';
import { type HouseholdDb, defaultHouseholdDb, registerHouseholdRoutes } from './routes/households.js';
import { type InviteDb, defaultInviteDb, registerInviteRoutes } from './routes/invites.js';
import { type MemberDb, defaultMemberDb, registerMemberRoutes } from './routes/members.js';
import { type BoardDb, defaultBoardDb, registerBoardRoutes } from './routes/boards.js';
import { type TaskDb, defaultTaskDb, registerTaskRoutes } from './routes/tasks.js';
import { type AlertDb, defaultAlertDb, registerAlertRoutes } from './routes/alerts.js';
import { type ChecklistDb, defaultChecklistDb, registerChecklistRoutes } from './routes/checklist.js';
import { type TextDb, defaultTextDb, registerTextRoutes } from './routes/text.js';

export interface AppDeps {
  /** Injected in local/manual testing; production builds the Cognito verifier lazily. */
  verify?: TokenVerifier;
  meDb?: MeDb;
  householdDb?: HouseholdDb;
  inviteDb?: InviteDb;
  memberDb?: MemberDb;
  boardDb?: BoardDb;
  taskDb?: TaskDb;
  alertDb?: AlertDb;
  checklistDb?: ChecklistDb;
  textDb?: TextDb;
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

  const verify = deps.verify ?? cognitoVerifier();
  const requireAuth = createAuthMiddleware(verify);

  // NOTE: `.use()` is plain Hono, so its path uses Hono's `:param` syntax —
  // `createRoute({ path })` inside the route modules above uses OpenAPI's
  // `{param}` syntax instead. They are not interchangeable.
  app.use('/v1/me', requireAuth);
  app.use('/v1/me/*', requireAuth);
  app.use('/v1/households', requireAuth);
  app.use('/v1/households/:hid', requireAuth, requireMembership());
  app.use('/v1/households/:hid/*', requireAuth, requireMembership());

  registerMeRoutes(app, deps.meDb ?? defaultMeDb);
  registerHouseholdRoutes(app, deps.householdDb ?? defaultHouseholdDb);
  registerInviteRoutes(app, deps.inviteDb ?? defaultInviteDb);
  registerMemberRoutes(app, deps.memberDb ?? defaultMemberDb);
  registerBoardRoutes(app, deps.boardDb ?? defaultBoardDb);
  registerTaskRoutes(app, deps.taskDb ?? defaultTaskDb);
  registerAlertRoutes(app, deps.alertDb ?? defaultAlertDb);
  registerChecklistRoutes(app, deps.checklistDb ?? defaultChecklistDb);
  registerTextRoutes(app, deps.textDb ?? defaultTextDb);

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
