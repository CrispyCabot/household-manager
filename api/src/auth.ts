import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { verifyDeviceToken } from './deviceToken.js';
import { ApiError } from './errors.js';

export interface AuthedUser {
  kind: 'user';
  sub: string;
  email: string;
}

/**
 * A wall-mounted dashboard, not a person — see FEATURE_ANALYSIS.md's Phase
 * 1. Carries no `sub`/`email`; every route that needs a human identity
 * (creating boards, inviting members, anything the household's audit trail
 * should attribute to someone) must call `requireUser()` rather than assume
 * `c.get('user')` is this shape.
 */
export interface AuthedDevice {
  kind: 'device';
  deviceId: string;
  householdId: string;
}

export type Principal = AuthedUser | AuthedDevice;

export type PrincipalVerifier = (token: string) => Promise<Principal>;
export type AuthedEnv = { Variables: { user: Principal } };

export function createAuthMiddleware(verify: PrincipalVerifier) {
  return createMiddleware<AuthedEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'unauthorized', 'Missing bearer token');
    }
    let principal: Principal;
    try {
      principal = await verify(header.slice('Bearer '.length));
    } catch {
      throw new ApiError(401, 'unauthorized', 'Invalid token');
    }
    c.set('user', principal);
    await next();
  });
}

/**
 * Narrows the current principal to a signed-in member, or rejects the
 * request with 403. This is the "opt in" half of the device authorization
 * model (FEATURE_ANALYSIS.md, "Authorization — the real refactor"): a route
 * that touches this returns the safe default automatically — a device is
 * rejected unless the route explicitly reads `c.get('user')` itself instead
 * (which is exactly what the small set of device-eligible routes, e.g. task
 * complete/snooze/dismiss and checklist toggle, do).
 */
export function requireUser(c: Context<AuthedEnv>): AuthedUser {
  const principal = c.get('user');
  if (principal.kind !== 'user') {
    throw new ApiError(403, 'forbidden', 'This action requires a signed-in household member');
  }
  return principal;
}

/**
 * Production verifier. Verifies the ID token, not the access token.
 *
 * Unlike Poster Walls Editor, this app needs `email` on nearly every
 * authenticated request — member records, invite claiming, the profile —
 * and Cognito puts standard attributes like `email` on the ID token, not
 * the access token. The SPA (see app/src/auth/AuthProvider.tsx) sends
 * `id_token` as the bearer token to match.
 *
 * Built lazily for the same reason as Poster Walls Editor: eager
 * construction would call CognitoJwtVerifier.create() with an empty pool ID
 * whenever a test injects its own `verify` and never exercises this path.
 */
export function cognitoVerifier(): (token: string) => Promise<AuthedUser> {
  let verifier: ReturnType<typeof buildVerifier> | undefined;

  function buildVerifier() {
    return CognitoJwtVerifier.create({
      userPoolId: process.env.USER_POOL_ID ?? '',
      tokenUse: 'id',
      clientId: process.env.USER_POOL_CLIENT_ID ?? '',
    });
  }

  return async (token) => {
    if (verifier === undefined) {
      try {
        verifier = buildVerifier();
      } catch (err) {
        console.error('failed to construct Cognito verifier', err);
        throw err;
      }
    }
    const payload = await verifier.verify(token);
    const email = payload.email;
    if (typeof email !== 'string') {
      // Self-signup requires a verified email before the pool issues tokens
      // at all, so this should be unreachable — but a missing claim must
      // fail loudly rather than store "undefined" as someone's email.
      throw new Error('ID token has no email claim');
    }
    if (payload.email_verified !== true) {
      // This app doesn't own the Cognito pool (it's a shared, account-wide
      // pool from a separate prerequisite project) and can't guarantee the
      // pool's self-signup config always withholds tokens until email
      // confirmation. Invite-claiming is entirely email-based, so an
      // unverified email would let someone claim another person's invites.
      throw new Error('ID token email is not verified');
    }
    return { kind: 'user', sub: payload.sub, email: email.toLowerCase() };
  };
}

/**
 * The production `PrincipalVerifier`: a Cognito ID token is always a
 * three-segment JWT (`header.payload.signature`); a device token
 * (`deviceToken.ts`) is always two (`body.signature`). That shape alone is
 * enough to route to the right verifier before either one's actual
 * cryptographic check runs, so a malformed token fails fast with a single
 * clear 401 regardless of which kind it was trying to be.
 */
export function principalVerifier(): PrincipalVerifier {
  const verifyUser = cognitoVerifier();
  return async (token) => {
    if (token.split('.').length === 2) {
      const payload = await verifyDeviceToken(token);
      return { kind: 'device', deviceId: payload.deviceId, householdId: payload.householdId };
    }
    return verifyUser(token);
  };
}
