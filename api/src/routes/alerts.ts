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
    return c.json({ alerts: await db.listAlertsForHousehold(hid) }, 200);
  });
}
