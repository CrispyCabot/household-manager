import { CfnOutput, Fn, SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ApiConstruct } from './constructs/api.js';
import { AuthConstruct } from './constructs/auth.js';
import { DataConstruct } from './constructs/data.js';
import { ReminderConstruct } from './constructs/reminder.js';
import { SesConstruct } from './constructs/ses.js';
import { WebConstruct } from './constructs/web.js';

/** The subdomain the app lives on. Its zone is delegated; the apex is not. */
export const DOMAIN_NAME = 'household-manager.chrisbridewell.dev';
export const API_DOMAIN_NAME = `api.${DOMAIN_NAME}`;

export interface MainStackProps extends StackProps {
  /** Two-phase switch — see spec §9. Flip to true once the NS records are delegated. */
  readonly useCustomDomain: boolean;
}

export class MainStack extends Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    const data = new DataConstruct(this, 'Data');

    const zone = new route53.PublicHostedZone(this, 'Zone', {
      zoneName: DOMAIN_NAME,
      comment: 'Delegated subdomain; the apex stays with the registrar',
    });

    const certificate = props.useCustomDomain
      ? new acm.Certificate(this, 'Certificate', {
          domainName: DOMAIN_NAME,
          subjectAlternativeNames: [API_DOMAIN_NAME],
          validation: acm.CertificateValidation.fromDns(zone),
        })
      : undefined;

    const web = new WebConstruct(this, 'Web', {
      ...(certificate === undefined ? {} : { domainName: DOMAIN_NAME, certificate }),
    });

    const webUrl = props.useCustomDomain
      ? `https://${DOMAIN_NAME}`
      : `https://${web.distribution.distributionDomainName}`;

    const auth = new AuthConstruct(this, 'Auth', {
      webOrigins: [
        `https://${web.distribution.distributionDomainName}`,
        ...(props.useCustomDomain ? [`https://${DOMAIN_NAME}`] : []),
        'http://localhost:5173',
      ],
    });

    const api = new ApiConstruct(this, 'Api', {
      table: data.table,
      userPoolId: auth.userPoolId,
      userPoolClientId: auth.client.userPoolClientId,
      ...(certificate === undefined ? {} : { domainName: API_DOMAIN_NAME, certificate }),
    });

    api.fn.addEnvironment('WEB_ORIGIN', webUrl);

    // Signs/verifies the one-click Complete/Snooze/Dismiss links the
    // reminder digest embeds (see api/src/actionToken.ts). Shared by both
    // Lambdas: the reminder Lambda signs, the main API Lambda's /actions/*
    // route (unauthenticated by design) verifies.
    const actionTokenSecret = new secretsmanager.Secret(this, 'ActionTokenSecret', {
      description: 'HMAC signing key for one-click email action links',
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });
    actionTokenSecret.grantRead(api.fn);
    api.fn.addEnvironment('ACTION_TOKEN_SECRET_ARN', actionTokenSecret.secretArn);

    // Signs/verifies short-lived device JWTs (api/src/deviceToken.ts) — the
    // wall-dashboard auth path (FEATURE_ANALYSIS.md's Phase 1). Deliberately
    // its own secret, not a reuse of actionTokenSecret: the two authorize
    // very different things, so rotating one must never affect the other.
    // Only the API Lambda ever touches it — unlike actionTokenSecret, no
    // other Lambda signs device tokens.
    const deviceTokenSecret = new secretsmanager.Secret(this, 'DeviceTokenSecret', {
      description: 'HMAC signing key for short-lived device JWTs',
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });
    deviceTokenSecret.grantRead(api.fn);
    api.fn.addEnvironment('DEVICE_TOKEN_SECRET_ARN', deviceTokenSecret.secretArn);

    // Google Calendar integration (FEATURE_ANALYSIS.md's Phase 2). Unlike
    // the two secrets above, CDK cannot generate this one's value — it's
    // the OAuth client id/secret from a Google Cloud Console project the
    // operator creates by hand (see that doc's console-setup steps), pasted
    // in after this deploys. The placeholder below is what ships until then;
    // `api/src/google/config.ts` fails loudly and specifically if it's still
    // in place when a route tries to use it.
    const googleClientCredentialsSecret = new secretsmanager.Secret(this, 'GoogleClientCredentialsSecret', {
      description: 'Google OAuth client id/secret for the household Calendar connection — fill in by hand after creating the OAuth client in Google Cloud Console',
      secretObjectValue: {
        clientId: SecretValue.unsafePlainText('REPLACE_ME'),
        clientSecret: SecretValue.unsafePlainText('REPLACE_ME'),
      },
    });
    googleClientCredentialsSecret.grantRead(api.fn);
    api.fn.addEnvironment('GOOGLE_CLIENT_CREDENTIALS_SECRET_ARN', googleClientCredentialsSecret.secretArn);

    // One Secrets Manager secret per household's Google refresh token,
    // created dynamically at connect time (db/google.ts's saveConnection) —
    // there's no fixed set of these for CDK to declare up front, so the
    // grant is scoped by name prefix instead of to specific resources.
    api.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue', 'secretsmanager:GetSecretValue', 'secretsmanager:DeleteSecret'],
        resources: [this.formatArn({ service: 'secretsmanager', resource: 'secret', resourceName: 'household-manager/google/*' })],
      }),
    );

    const apiUrl = api.domain === undefined ? api.httpApi.apiEndpoint : `https://${API_DOMAIN_NAME}`;
    // Read back by google/config.ts to build the OAuth redirect URI, which
    // must exactly match what's configured on the Google OAuth client.
    api.fn.addEnvironment('API_ORIGIN', apiUrl);

    if (api.domain !== undefined) {
      const toDistribution = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(web.distribution));
      new route53.ARecord(this, 'AppAlias', { zone, target: toDistribution });
      new route53.AaaaRecord(this, 'AppAliasV6', { zone, target: toDistribution });
      new route53.ARecord(this, 'ApiAlias', {
        zone,
        recordName: 'api',
        target: route53.RecordTarget.fromAlias(
          new targets.ApiGatewayv2DomainProperties(api.domain.regionalDomainName, api.domain.regionalHostedZoneId),
        ),
      });
    }

    // Gated with the custom domain for the same reason the certificate is:
    // DKIM's CNAME records cannot validate until the zone resolves.
    if (certificate !== undefined) {
      const ses = new SesConstruct(this, 'Ses', { zone });
      const reminder = new ReminderConstruct(this, 'Reminder', {
        table: data.table,
        emailIdentity: ses.identity,
        domainName: DOMAIN_NAME,
        apiDomainName: API_DOMAIN_NAME,
        actionTokenSecret,
      });
      new CfnOutput(this, 'ReminderFromAddress', { value: `reminders@${DOMAIN_NAME}` });

      // Lets the API's "Notify now" endpoint (routes/notify.ts) synchronously
      // invoke the reminder Lambda for one household, on demand, reusing the
      // exact same send/snooze logic the hourly sweep runs instead of a
      // second copy of it in the API Lambda.
      reminder.fn.grantInvoke(api.fn);
      api.fn.addEnvironment('REMINDER_FN_NAME', reminder.fn.functionName);

      // The reminder Lambda's hourly run also retries calendar syncs left
      // pending/errored by the API Lambda (reminder.ts's call to
      // reconcilePendingCalendarSyncs — FEATURE_ANALYSIS.md's Phase 3). It
      // needs the same Google client credentials and the same read-only
      // access to each household's dynamic refresh-token secret as the API
      // Lambda — never write access, since only the OAuth connect/disconnect
      // flow (which only the API Lambda runs) creates or deletes those.
      googleClientCredentialsSecret.grantRead(reminder.fn);
      reminder.fn.addEnvironment('GOOGLE_CLIENT_CREDENTIALS_SECRET_ARN', googleClientCredentialsSecret.secretArn);
      reminder.fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [this.formatArn({ service: 'secretsmanager', resource: 'secret', resourceName: 'household-manager/google/*' })],
        }),
      );
    }

    // Read by the deploy workflow (.github/workflows/deploy.yml) to sync
    // GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET GitHub Actions secrets into this
    // secret's value on every deploy — see that workflow's "Sync Google
    // OAuth credentials" step. Not sensitive itself (an ARN names a
    // resource, it isn't a credential), so a plain output is fine.
    new CfnOutput(this, 'GoogleClientCredentialsSecretArn', { value: googleClientCredentialsSecret.secretArn });

    new CfnOutput(this, 'ApiUrl', { value: apiUrl });
    new CfnOutput(this, 'TableName', { value: data.table.tableName });
    new CfnOutput(this, 'WebUrl', { value: webUrl });
    new CfnOutput(this, 'WebBucketName', { value: web.webBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: web.distribution.distributionId });
    new CfnOutput(this, 'UserPoolId', { value: auth.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: auth.client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', {
      value: `https://${auth.hostedDomain}.auth.${this.region}.amazoncognito.com`,
    });
    new CfnOutput(this, 'ZoneNameServers', {
      description: 'Add these as NS records for host "household-manager" at your registrar',
      value: Fn.join(', ', zone.hostedZoneNameServers ?? []),
    });
    new CfnOutput(this, 'CustomDomainEnabled', { value: String(props.useCustomDomain) });
  }
}
