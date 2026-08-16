import { RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Single-table store. GSI1 is the sparse reminder queue (spec §4, §6): only
 * a currently-notifiable task carries GSI1PK/GSI1SK, so the phase-3 reminder
 * Lambda's query naturally excludes completed and dismissed tasks rather
 * than filtering them out after the fact.
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
