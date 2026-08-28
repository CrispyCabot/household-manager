import { loadRefreshToken, markNeedsReauth, markRefreshed } from '../db/google.js';
import { googleClientCredentials } from './config.js';
import { GoogleReauthRequiredError, refreshAccessToken } from './oauth.js';

/**
 * Cached at module scope, keyed by household — reused across invocations of
 * the same warm Lambda container (FEATURE_ANALYSIS.md's Phase 2: "cached in
 * Lambda container memory for its ~1 hour life, so most invocations skip
 * the round trip"). Not persisted anywhere: an access token is short-lived
 * and cheap to reissue, so there's nothing worth surviving a cold start for.
 */
const cache = new Map<string, { accessToken: string; expiresAtMs: number }>();

export class GoogleNotConnectedError extends Error {}

/**
 * Returns a live access token for the household's connected Google account,
 * refreshing (and re-caching) only when the cached one is missing or within
 * a minute of expiring. Throws `GoogleNotConnectedError` if the household
 * has never connected one, or `GoogleReauthRequiredError` (re-exported from
 * `oauth.ts`) if Google has revoked the stored refresh token — both are
 * meant to be caught by the calling route and turned into a specific
 * client-facing error rather than a generic 500.
 */
export async function getAccessToken(householdId: string): Promise<string> {
  const cached = cache.get(householdId);
  if (cached !== undefined && cached.expiresAtMs - Date.now() > 60_000) {
    return cached.accessToken;
  }

  const refreshToken = await loadRefreshToken(householdId);
  if (refreshToken === null) throw new GoogleNotConnectedError(`Household ${householdId} has no connected Google account`);

  try {
    const { clientId, clientSecret } = await googleClientCredentials();
    const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken });
    cache.set(householdId, { accessToken: refreshed.accessToken, expiresAtMs: new Date(refreshed.accessTokenExpiresAt).getTime() });
    await markRefreshed(householdId);
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof GoogleReauthRequiredError) {
      await markNeedsReauth(householdId);
    }
    throw err;
  }
}

export { GoogleReauthRequiredError } from './oauth.js';
