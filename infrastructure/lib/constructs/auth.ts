import { Duration } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AuthConstructProps {
  /** Callback/logout origins for THIS app's client. */
  readonly webOrigins: string[];
}

/**
 * This app's client on the account's shared Cognito pool (spec §2). The pool
 * is owned by CoreInfra; this construct never declares one — it reads the
 * published contract and adds only its own client.
 */
export class AuthConstruct extends Construct {
  readonly userPoolId: string;
  readonly client: cognito.UserPoolClient;
  /** The Claude custom connector's client — see api/src/mcp/oauth.ts. */
  readonly mcpClient: cognito.UserPoolClient;
  readonly hostedDomain: string;

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    this.userPoolId = ssm.StringParameter.valueForStringParameter(this, '/core/auth/user-pool-id');
    this.hostedDomain = ssm.StringParameter.valueForStringParameter(this, '/core/auth/hosted-domain');

    // fromUserPoolId() returns IUserPool, not the concrete UserPool class —
    // but IUserPool still exposes addClient(): a client only needs the
    // pool's ID/ARN, not its full configuration, so this is sufficient for
    // an app that does not own the pool.
    const pool = cognito.UserPool.fromUserPoolId(this, 'ImportedPool', this.userPoolId);

    this.client = pool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: props.webOrigins.map((o) => `${o}/callback`),
        logoutUrls: props.webOrigins,
      },
      preventUserExistenceErrors: true,
      // How long a signed-in session can last before requiring a fresh
      // login, provided the app keeps using the refresh token — see
      // app/src/auth/AuthProvider.tsx, which renews the 1-hour access/ID
      // token from it on startup, on returning to the tab, and (via
      // oidc.ts's automaticSilentRenew) while open, rather than treating an
      // expired token as a sign-out. Applies to refresh tokens issued after
      // this deploys; existing ones keep their original 60 days.
      refreshTokenValidity: Duration.days(365),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    });

    // Signs a household member in to the Claude custom connector
    // (api/src/mcp/). Public, like WebClient: the connector's OAuth facade
    // hands this id to any MCP client that registers, so it must not be
    // the thing that authorizes anything. What does is that Cognito only
    // ever redirects a sign-in to the callback URLs listed here (Claude's),
    // and that the code exchange needs the PKCE verifier only that client
    // holds.
    this.mcpClient = pool.addClient('ClaudeConnectorClient', {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'],
      },
      preventUserExistenceErrors: true,
      // Claude refreshes the 1-hour token on its own; after this long
      // without use, connecting again means signing in again.
      refreshTokenValidity: Duration.days(90),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    });
  }
}
