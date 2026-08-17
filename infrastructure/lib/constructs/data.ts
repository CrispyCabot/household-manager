import { RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Single-table store. GSI1 is the sparse reminder queue (spec §4, §6):
 * every active, non-dismissed task carries GSI1PK/GSI1SK, keyed by its
 * future nag-start moment — not only tasks currently due. It's the
 * phase-3 reminder Lambda's `GSI1SK <= now` query condition, not index
 * membership, that narrows this down to currently-due tasks; the
 * handler's own filter (task-level `notify.email`, `status === 'active'`,
 * and `!dismissed`) does the rest.
 */
export class DataConstruct extends Construct {
  readonly table: dynamodb.TableV2;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
      ],
    });
  }
}
