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
    });
  }
}
