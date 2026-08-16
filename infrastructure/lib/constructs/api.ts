import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface ApiConstructProps {
  readonly table: dynamodb.TableV2;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly domainName?: string;
  readonly certificate?: acm.ICertificate;
}

export class ApiConstruct extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly fn: NodejsFunction;
  readonly domain: apigwv2.DomainName | undefined;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'FnLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fn = new NodejsFunction(this, 'Fn', {
      entry: fileURLToPath(new URL('../../../api/src/lambda.ts', import.meta.url)),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      logGroup,
      environment: {
        TABLE_NAME: props.table.tableName,
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: { minify: true, sourceMap: true },
    });

    props.table.grantReadWriteData(this.fn);

    if (props.domainName !== undefined && props.certificate !== undefined) {
      this.domain = new apigwv2.DomainName(this, 'DomainName', {
        domainName: props.domainName,
        certificate: props.certificate,
      });
    }

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      ...(this.domain === undefined ? {} : { defaultDomainMapping: { domainName: this.domain } }),
      // Hono owns CORS. Deliberately NOT named 'Default' — see the
      // Poster Walls Editor api.ts comment on logical-ID collisions if this
      // needs revisiting.
      defaultIntegration: new HttpLambdaIntegration('DefaultIntegration', this.fn),
    });
  }
}
