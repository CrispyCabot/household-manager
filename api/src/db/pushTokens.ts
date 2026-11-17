import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PUSH_SK_PREFIX, pushTokenSk, userPk } from '@hhm/shared';
import { docClient, tableName } from './client.js';
import { queryAllPages } from './tasks.js';

export async function savePushToken(sub: string, token: string, now: string): Promise<void> {
  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: userPk(sub), SK: pushTokenSk(token), token, updatedAt: now },
    }),
  );
}

export async function removePushToken(sub: string, token: string): Promise<void> {
  await docClient().send(
    new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: pushTokenSk(token) } }),
  );
}

export async function listPushTokens(sub: string): Promise<string[]> {
  const items = await queryAllPages({
    TableName: tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': userPk(sub), ':sk': PUSH_SK_PREFIX },
  });
  return items.map((i) => String(i.token));
}
