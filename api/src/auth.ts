import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createMiddleware } from 'hono/factory';
import { ApiError } from './errors.js';

export interface AuthedUser {
  sub: string;
  email: string;
}

export type TokenVerifier = (token: string) => Promise<AuthedUser>;
export type AuthedEnv = { Variables: { user: AuthedUser } };

export function createAuthMiddleware(verify: TokenVerifier) {
  return createMiddleware<AuthedEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'unauthorized', 'Missing bearer token');
    }
    let user: AuthedUser;
    try {
      user = await verify(header.slice('Bearer '.length));
    } catch {
      throw new ApiError(401, 'unauthorized', 'Invalid token');
    }
    c.set('user', user);
    await next();
  });
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
export function cognitoVerifier(): TokenVerifier {
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
    return { sub: payload.sub, email: email.toLowerCase() };
  };
}
