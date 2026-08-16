import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let cached: DynamoDBDocumentClient | undefined;

export function docClient(): DynamoDBDocumentClient {
  cached ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (name === undefined || name === '') {
    throw new Error('TABLE_NAME is not set');
  }
  return name;
}

export function resetDocClient(): void {
  cached = undefined;
}
