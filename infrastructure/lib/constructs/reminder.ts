import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface ReminderConstructProps {
  readonly table: dynamodb.TableV2;
  readonly emailIdentity: ses.EmailIdentity;
  readonly domainName: string;
}

export class ReminderConstruct extends Construct {
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
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: { minify: true, sourceMap: true },
    });

    props.table.grantReadWriteData(fn);

    // TableV2's grant methods already widen to the table's GSIs, so this
    // covers the GSI1 query the Lambda runs — no separate index grant.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [props.emailIdentity.emailIdentityArn],
      }),
    );

    new events.Rule(this, 'HourlyTrigger', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
