import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { IdSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import type { ReminderEvent, ReminderResult } from '../reminder.js';

const lambdaClient = new LambdaClient({});

function reminderFnName(): string {
  const name = process.env.REMINDER_FN_NAME;
  if (name === undefined || name === '') throw new Error('REMINDER_FN_NAME is not set');
  return name;
}

/**
 * Synchronously invokes the reminder Lambda (api/src/reminder.ts), scoped to
 * one household — the exact same due-check, send, and auto-snooze logic the
 * hourly sweep runs, just filtered down to `householdId` instead of every
 * household in the account. Deliberately does not duplicate that logic here;
 * see main-stack.ts for the `lambda:InvokeFunction` grant this depends on.
 */
async function notifyHousehold(householdId: string): Promise<ReminderResult> {
  const event: ReminderEvent = { householdId };
  const result = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: reminderFnName(),
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(event),
    }),
  );

  if (result.FunctionError !== undefined) {
    const payload = result.Payload === undefined ? '' : Buffer.from(result.Payload).toString('utf-8');
    throw new Error(`reminder Lambda invoke failed: ${result.FunctionError} ${payload}`);
  }
  if (result.Payload === undefined) throw new Error('reminder Lambda returned no payload');
  return JSON.parse(Buffer.from(result.Payload).toString('utf-8')) as ReminderResult;
}

export interface NotifyDb {
  notifyHousehold: typeof notifyHousehold;
}

export const defaultNotifyDb: NotifyDb = { notifyHousehold };

const notifyRoute = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/notify',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ tasksNotified: z.number(), delivered: z.boolean() }) } },
      description: 'Ran the due-check for this household immediately instead of waiting for the next hourly sweep',
    },
  },
});

export function registerNotifyRoutes(app: OpenAPIHono<AuthedEnv>, db: NotifyDb): void {
  app.openapi(notifyRoute, async (c) => {
    const { hid } = c.req.valid('param');
    try {
      const result = await db.notifyHousehold(hid);
      return c.json(result, 200);
    } catch (err) {
      console.error(`failed to trigger on-demand notify for household ${hid}`, err);
      throw new ApiError(500, 'notify_failed', 'Failed to trigger notifications');
    }
  });
}
