const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Two calendar scopes, not one — `calendar.events` alone was tried first and
 * is *not* sufficient: it covers reading/writing events, but Google rejects
 * `calendarList.list` (routes/google.ts's calendar picker) under it with
 * `ACCESS_TOKEN_SCOPE_INSUFFICIENT` — listing which calendars exist is a
 * separate permission from reading/writing events on them. `calendar.readonly`
 * is what actually grants that (plus read access to events, redundant with
 * but harmless alongside `calendar.events`'s write access) without going all
 * the way to the unrestricted `calendar` scope, which would additionally
 * allow deleting/creating whole calendars — more than this app needs.
 *
 * `openid email` is what puts an `email` claim on the ID token this flow
 * gets back, which is the account-email display Settings shows ("connected
 * as ...") without a second API call.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export function buildAuthUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  // Both required for a refresh token to come back at all, and for it to
  // keep working: without access_type=offline, Google issues an access
  // token only; without prompt=consent, a user who already granted this
  // app access once won't be re-prompted, so a *replacement* refresh token
  // is never issued even if the household's connection needs one (e.g.
  // after a revoke-and-reconnect).
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope: string;
}

export interface ExchangedTokens {
  accessToken: string;
  /** Absent when Google doesn't issue one — see `exchangeCodeForTokens`'s doc comment. */
  refreshToken: string | null;
  accessTokenExpiresAt: string;
  /** Decoded from the ID token's `email` claim — see this module's note on why that's safe without independently verifying the JWT signature. */
  email: string;
  scopes: string[];
}

/**
 * Decodes (does not verify) a JWT's payload. Safe here specifically because
 * the token arrives directly from Google's token endpoint over a
 * server-to-server HTTPS call this process just made — it is not
 * client-supplied input, so there is nothing for a forged signature to
 * defeat. This must never be reused for a token that arrived any other way.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3 || parts[1] === undefined) throw new Error('malformed JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * A refresh token is only ever returned the *first* time a user consents
 * with `prompt=consent access_type=offline` for this client — a repeat
 * exchange (e.g. re-running the flow without revoking first) can come back
 * with `refresh_token` absent. Callers must treat `null` here as "keep
 * whatever refresh token is already stored", not as connection failure.
 */
export async function exchangeCodeForTokens(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<ExchangedTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as GoogleTokenResponse;
  const email = body.id_token !== undefined ? decodeJwtPayload(body.id_token).email : undefined;
  if (typeof email !== 'string') {
    throw new Error('Google token response had no email claim on its ID token');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    accessTokenExpiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    email,
    scopes: body.scope.split(' '),
  };
}

export interface RefreshedAccessToken {
  accessToken: string;
  accessTokenExpiresAt: string;
}

export class GoogleReauthRequiredError extends Error {}

/** Exchanges a stored refresh token for a fresh access token. Throws `GoogleReauthRequiredError` if Google has revoked it (password change, "Remove access" in the user's Google account, 6 months unused). */
export async function refreshAccessToken(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<RefreshedAccessToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (res.status === 400 || res.status === 401) {
    throw new GoogleReauthRequiredError(`Google rejected the stored refresh token: ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as GoogleTokenResponse;
  return { accessToken: body.access_token, accessTokenExpiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() };
}
