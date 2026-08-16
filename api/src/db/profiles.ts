import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PROFILE, userPk } from '@hhm/shared';
import type { Profile } from '@hhm/shared';
import { docClient, tableName } from './client.js';

/**
 * Called on every `GET /me`. Idempotent: `if_not_exists` means an existing
 * `lastHouseholdId` is never clobbered by a routine profile touch.
 */
export async function upsertProfile(sub: string, email: string): Promise<Profile> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression:
        'SET sub = :sub, email = :email, lastHouseholdId = if_not_exists(lastHouseholdId, :null)',
      ExpressionAttributeValues: { ':sub': sub, ':email': email, ':null': null },
    }),
  );
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: PROFILE } }),
  );
  const i = result.Item ?? {};
  return {
    sub: String(i.sub ?? sub),
    email: String(i.email ?? email),
    lastHouseholdId: (i.lastHouseholdId as string | null | undefined) ?? null,
  };
}

export async function setLastHousehold(sub: string, householdId: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET lastHouseholdId = :id',
      ExpressionAttributeValues: { ':id': householdId },
    }),
  );
}
