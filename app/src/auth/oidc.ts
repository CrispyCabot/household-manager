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
});
