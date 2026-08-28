import type { CalendarEvent, GoogleCalendar, GoogleConnection } from '@hhm/shared';
import { deleteConnection, loadConnection, saveConnection } from '../db/google.js';
import { getAccessToken } from './accessToken.js';
import { listCalendars, listEvents } from './calendar.js';
import { googleClientCredentials, googleRedirectUri } from './config.js';
import { buildAuthUrl, exchangeCodeForTokens } from './oauth.js';
import { signOAuthState, verifyOAuthState } from './state.js';

/**
 * The one place `routes/google.ts` and the calendar board's events route
 * talk to, composing `db/google.ts` (storage), `oauth.ts` (the token
 * dance), `calendar.ts` (the Calendar API itself), and `state.ts` (the
 * signed redirect param) — kept separate from those so each stays testable
 * on its own, the same shape as `db/tasks.ts` sitting under `routes/tasks.ts`.
 */

export async function buildGoogleAuthUrl(householdId: string, requestedBy: string): Promise<string> {
  const { clientId } = googleClientCredentials();
  const state = await signOAuthState({ householdId, connectedBy: requestedBy });
  return buildAuthUrl({ clientId, redirectUri: googleRedirectUri(), state });
}

export class OAuthCallbackError extends Error {
  constructor(
    message: string,
    readonly redirectHouseholdId: string | null,
  ) {
    super(message);
  }
}

/**
 * Handles Google's redirect back to `/v1/google/callback` — verifies
 * `state`, exchanges `code`, and stores the connection. Returns the
 * household id so the route can redirect the browser back into the app;
 * throws `OAuthCallbackError` (carrying whatever household id was
 * recovered, if any, so the route can still send the user somewhere
 * sensible) on any failure.
 */
export async function completeGoogleOAuth(input: { code: string; state: string }): Promise<string> {
  let oauthState: { householdId: string; connectedBy: string };
  try {
    oauthState = await verifyOAuthState(input.state);
  } catch (err) {
    throw new OAuthCallbackError(`invalid or expired state: ${(err as Error).message}`, null);
  }

  try {
    const { clientId, clientSecret } = googleClientCredentials();
    const tokens = await exchangeCodeForTokens({ clientId, clientSecret, redirectUri: googleRedirectUri(), code: input.code });
    if (tokens.refreshToken === null) {
      // Google only omits this when the household already granted this
      // exact app access before without a fresh consent prompt in between —
      // buildGoogleAuthUrl always sends prompt=consent specifically to make
      // this unreachable in the normal flow, but a directly-crafted request
      // could still hit it, and silently keeping a stale-or-absent token
      // would be worse than failing loudly here.
      throw new Error('Google did not return a refresh token for this consent');
    }
    await saveConnection({
      householdId: oauthState.householdId,
      googleAccountEmail: tokens.email,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      connectedBy: oauthState.connectedBy,
    });
    return oauthState.householdId;
  } catch (err) {
    throw new OAuthCallbackError((err as Error).message, oauthState.householdId);
  }
}

export async function getGoogleConnection(householdId: string): Promise<GoogleConnection | null> {
  return loadConnection(householdId);
}

export async function disconnectGoogle(householdId: string): Promise<boolean> {
  return deleteConnection(householdId);
}

export async function listHouseholdCalendars(householdId: string): Promise<GoogleCalendar[]> {
  const accessToken = await getAccessToken(householdId);
  return listCalendars(accessToken);
}

export async function listBoardEvents(householdId: string, calendarIds: string[], range: { from: string; to: string }): Promise<CalendarEvent[]> {
  if (calendarIds.length === 0) return [];
  const accessToken = await getAccessToken(householdId);
  return listEvents(accessToken, calendarIds, range);
}
