import { CfnOutput, Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
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

    const apiUrl = api.domain === undefined ? api.httpApi.apiEndpoint : `https://${API_DOMAIN_NAME}`;

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
      new ReminderConstruct(this, 'Reminder', {
        table: data.table,
        emailIdentity: ses.identity,
        domainName: DOMAIN_NAME,
      });
      new CfnOutput(this, 'ReminderFromAddress', { value: `reminders@${DOMAIN_NAME}` });
    }

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
