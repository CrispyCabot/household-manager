import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { getConfig } from '../config.js';

const config = getConfig();

export const userManager = new UserManager({
  authority: config.cognitoDomain,
  // Cognito does not serve OIDC discovery at the Hosted UI domain, so the
  // endpoints are declared explicitly. No end_session_endpoint — sign-out
  // uses Cognito's own /logout URL shape directly (see signOut() below),
  // not oidc-client-ts's generic OIDC signout flow.
  metadata: {
    issuer: config.cognitoDomain,
    authorization_endpoint: `${config.cognitoDomain}/oauth2/authorize`,
    token_endpoint: `${config.cognitoDomain}/oauth2/token`,
    userinfo_endpoint: `${config.cognitoDomain}/oauth2/userInfo`,
  },
  client_id: config.userPoolClientId,
  redirect_uri: config.redirectUri,
  response_type: 'code',
  scope: 'openid email profile',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  // Without this, nothing renews the ~1 hour access/ID token before it
  // expires — AuthProvider treats an expired token as signed-out, so users
  // were effectively logged out hourly regardless of how long the
  // underlying Cognito refresh token (see infrastructure's auth construct)
  // is actually valid for. oidc-client-ts's signinSilent() automatically
  // renews via the token endpoint's refresh_token grant whenever the stored
  // user has one (Cognito always issues one here) — no silent_redirect_uri
  // or iframe needed, which matters since Cognito's Hosted UI doesn't
  // reliably support the prompt=none iframe flow anyway.
  automaticSilentRenew: true,
});

/**
 * Cognito's hosted /logout endpoint is not a standards-compliant OIDC
 * end_session_endpoint: it ignores RP-Initiated Logout's
 * `post_logout_redirect_uri` (what `userManager.signoutRedirect()` sends)
 * and instead expects its own `logout_uri` param, which must exactly match
 * a "Sign out URL" configured on the app client (see infrastructure's auth
 * construct — `logoutUrls`). Sending the param Cognito doesn't recognize is
 * what produced its generic "An error was encountered with the requested
 * page" instead of a redirect, so this builds Cognito's own URL shape
 * directly rather than going through the library's generic signout flow.
 */
export async function signOut(): Promise<void> {
  await userManager.removeUser();
  const url = new URL(`${config.cognitoDomain}/logout`);
  url.searchParams.set('client_id', config.userPoolClientId);
  url.searchParams.set('logout_uri', window.location.origin);
  window.location.assign(url.toString());
}
