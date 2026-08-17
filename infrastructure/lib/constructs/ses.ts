import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';

export interface SesConstructProps {
  readonly zone: route53.IHostedZone;
}

/**
 * A domain identity, not a single-address one — any address at this domain
 * (`reminders@`, later others) is covered by one verification. Verifying
 * against the zone this stack already owns (`Identity.publicHostedZone`,
 * not `Identity.domain`) is what makes DKIM's CNAME records get created
 * automatically rather than needing to be copied in by hand.
 */
export class SesConstruct extends Construct {
  readonly identity: ses.EmailIdentity;

  constructor(scope: Construct, id: string, props: SesConstructProps) {
    super(scope, id);

    this.identity = new ses.EmailIdentity(this, 'Identity', {
      identity: ses.Identity.publicHostedZone(props.zone),
    });
  }
}
