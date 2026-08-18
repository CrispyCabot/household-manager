import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface ReminderConstructProps {
  readonly table: dynamodb.TableV2;
  readonly emailIdentity: ses.EmailIdentity;
  readonly domainName: string;
  /** Where the digest's task links point — the API's own domain, since /actions/* is served there, not by the SPA. */
  readonly apiDomainName: string;
  /** Signs the one-click Complete/Snooze/Dismiss action links this Lambda embeds in each digest — verified by the API's /actions/* route. */
  readonly actionTokenSecret: secretsmanager.Secret;
}

export class ReminderConstruct extends Construct {
  /** Exposed so the API Lambda can be granted `lambda:InvokeFunction` on it — see main-stack.ts, which wires it up for the on-demand "Notify now" endpoint. */
  readonly fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ReminderConstructProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'FnLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'Fn', {
      entry: fileURLToPath(new URL('../../../api/src/reminder.ts', import.meta.url)),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.minutes(2),
      logGroup,
      environment: {
        TABLE_NAME: props.table.tableName,
        WEB_DOMAIN: props.domainName,
        API_BASE_URL: `https://${props.apiDomainName}`,
        ACTION_TOKEN_SECRET_ARN: props.actionTokenSecret.secretArn,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: { minify: true, sourceMap: true },
    });
    this.fn = fn;

    props.table.grantReadWriteData(fn);
    props.actionTokenSecret.grantRead(fn);

    // TableV2's grant methods already widen to the table's GSIs, so this
    // covers the GSI1 query the Lambda runs — no separate index grant.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        // Scoped to SES identity resources in this account/region only — not a
        // bare '*'. Recipient identity ARNs are unknowable in advance (every
        // future recipient is a different identity, and a sandboxed account
        // also enforces resource-level checks against the recipient's own
        // identity ARN, not just the sender's), so the resource name itself
        // must be a wildcard. The service/account/region segments stay fixed,
        // so this grant cannot reach SES resources outside this stack's own
        // account — it does not become a blanket '*' across all services.
        resources: [Stack.of(this).formatArn({ service: 'ses', resource: 'identity', resourceName: '*' })],
      }),
    );

    new events.Rule(this, 'HourlyTrigger', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
