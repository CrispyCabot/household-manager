import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PUSH_SK_PREFIX, pushTokenSk, userPk } from '@hhm/shared';
import { docClient, tableName } from './client.js';
import { queryAllPages } from './tasks.js';

export interface PushTarget {
  token: string;
  /** The phone draws reminders itself, with Mark complete and Dismiss buttons, so it's sent data-only messages. */
  actionButtons: boolean;
}

export async function savePushToken(sub: string, token: string, now: string, actionButtons = false): Promise<void> {
  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: userPk(sub), SK: pushTokenSk(token), token, actionButtons, updatedAt: now },
    }),
  );
}

export async function removePushToken(sub: string, token: string): Promise<void> {
  await docClient().send(
    new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: pushTokenSk(token) } }),
  );
}

export async function isPushTokenRegistered(sub: string, token: string): Promise<boolean> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: pushTokenSk(token) } }),
  );
  return result.Item !== undefined;
}

export async function listPushTokens(sub: string): Promise<PushTarget[]> {
  const items = await queryAllPages({
    TableName: tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': userPk(sub), ':sk': PUSH_SK_PREFIX },
  });
  return items.map((i) => ({ token: String(i.token), actionButtons: i.actionButtons === true }));
}
