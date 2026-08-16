import { createMiddleware } from 'hono/factory';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { isMember } from '../db/households.js';

export type HouseholdEnv = AuthedEnv & { Variables: { householdId: string } };

/**
 * Resolves `:hid` and confirms the caller belongs to it.
 *
 * Reads the raw path param, not `c.req.valid('param')` — this runs as
 * Hono `.use()` middleware ahead of `@hono/zod-openapi`'s own per-route
 * parameter validation, so the validated form is not available here yet.
 *
 * Failure is 404, never 403: a household a stranger does not belong to must
 * look identical to one that does not exist, so IDs cannot be probed.
 */
export function requireMembership(checkMembership: typeof isMember = isMember) {
  return createMiddleware<HouseholdEnv>(async (c, next) => {
    // Asserted `string`: `createMiddleware<HouseholdEnv>` carries no literal
    // path-pattern generic, so Hono's `param()` overload resolution falls
    // back to `(key: string) => string | undefined` here. The value is
    // still guaranteed present at runtime — Hono only invokes this
    // middleware once the `:hid` segment of the matched route has matched.
    const householdId = c.req.param('hid') as string;
    const { sub } = c.get('user');
    if (!(await checkMembership(householdId, sub))) {
      throw new ApiError(404, 'not_found', 'Not found');
    }
    c.set('householdId', householdId);
    await next();
  });
}
