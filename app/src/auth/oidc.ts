import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { getConfig } from '../config.js';

const config = getConfig();

export const userManager = new UserManager({
  authority: config.cognitoDomain,
  // Cognito does not serve OIDC discovery at the Hosted UI domain, so the
  // endpoints are declared explicitly.
  metadata: {
    issuer: config.cognitoDomain,
    authorization_endpoint: `${config.cognitoDomain}/oauth2/authorize`,
    token_endpoint: `${config.cognitoDomain}/oauth2/token`,
    userinfo_endpoint: `${config.cognitoDomain}/oauth2/userInfo`,
    end_session_endpoint: `${config.cognitoDomain}/logout`,
  },
  client_id: config.userPoolClientId,
  redirect_uri: config.redirectUri,
  post_logout_redirect_uri: window.location.origin,
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
