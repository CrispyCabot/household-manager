import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, TaskSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { listAlertsForHousehold } from '../db/tasks.js';

export interface AlertDb {
  listAlertsForHousehold: typeof listAlertsForHousehold;
}

export const defaultAlertDb: AlertDb = { listAlertsForHousehold };

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/alerts',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ alerts: z.array(TaskSchema) }) } }, description: 'Everything currently nagging, across every board' },
  },
});

export function registerAlertRoutes(app: OpenAPIHono<AuthedEnv>, db: AlertDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid } = c.req.valid('param');
    const alerts = await db.listAlertsForHousehold(hid);
    // Mirrors the email digest's targeting (reminder.ts): a task with an
    // `assigneeId` should alert only that member, not the whole household.
    // A signed-in member's own `sub` is available here (set by the auth
    // middleware — see auth.ts), so this route scopes their alerts to
    // unassigned tasks plus ones assigned to them. A device principal (a
    // wall dashboard — see AuthedDevice) has no `sub` of its own; it's a
    // shared household surface rather than one person's view, so it keeps
    // seeing every active alert, unfiltered.
    const principal = c.get('user');
    const scoped =
      principal.kind === 'user'
        ? alerts.filter((t) => t.assigneeId === null || t.assigneeId === principal.sub)
        : alerts;
    return c.json({ alerts: scoped }, 200);
  });
}
