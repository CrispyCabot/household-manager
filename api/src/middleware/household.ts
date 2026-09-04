import { createMiddleware } from 'hono/factory';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { isMember } from '../db/households.js';

export type HouseholdEnv = AuthedEnv & { Variables: { householdId: string } };

/**
 * Resolves `:hid` and confirms the caller belongs to it — a user by
 * membership lookup, a device by its token's own `householdId` claim
 * (a device belongs to exactly one household by construction; see
 * `db/devices.ts`'s `claimPairing`, which is the only place that claim is
 * ever written). No DB read for the device path: revocation is enforced at
 * token-exchange time (`routes/devices.ts`'s `/v1/devices/token`, which
 * fails once the device record is deleted), bounded by the token's own
 * short TTL — see `deviceToken.ts`'s `DEVICE_TOKEN_TTL_SECONDS`.
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
    const principal = c.get('user');

    const belongs = principal.kind === 'device' ? principal.householdId === householdId : await checkMembership(householdId, principal.sub);
    if (!belongs) {
      throw new ApiError(404, 'not_found', 'Not found');
    }
    c.set('householdId', householdId);
    await next();
  });
}
