import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { householdInviteSk, householdPk, invitePk, normalizeEmail } from '@hhm/shared';
import type { Invite } from '@hhm/shared';
import { docClient, tableName } from './client.js';
import { addMember } from './households.js';

export async function createInvite(householdId: string, email: string): Promise<Invite> {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();

  // Both directions written together: "pending invites for this household"
  // and "pending invites for this email" must always agree, or claiming
  // could see one without the other.
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { PK: householdPk(householdId), SK: householdInviteSk(normalized), email: normalized, invitedAt: now },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: { PK: invitePk(normalized), SK: householdPk(householdId), householdId, invitedAt: now },
          },
        },
      ],
    }),
  );

  return { householdId, email: normalized, invitedAt: now };
}

export async function listInvites(householdId: string): Promise<Invite[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'INVITE#' },
    }),
  );
  return (result.Items ?? []).map((i) => ({
    householdId,
    email: String(i.email),
    invitedAt: String(i.invitedAt),
  }));
}

export async function revokeInvite(householdId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: tableName(), Key: { PK: householdPk(householdId), SK: householdInviteSk(normalized) } } },
        { Delete: { TableName: tableName(), Key: { PK: invitePk(normalized), SK: householdPk(householdId) } } },
      ],
    }),
  );
}

/**
 * Converts every pending invite for this email into membership.
 *
 * Called from `GET /me` on every request (routes/me.ts) — this is what lets
 * someone be invited before they have an account. They sign up, and the
 * next time they load the app the household is simply there.
 */
export async function claimInvites(sub: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': invitePk(normalized) },
    }),
  );

  for (const invite of result.Items ?? []) {
    const householdId = String(invite.householdId);
    try {
      await addMember(householdId, sub, normalized);
    } catch (err) {
      // The household this invite points at no longer exists (e.g. it was
      // deleted before deleteHousehold cleaned up both invite halves, or for
      // any other reason the referenced household is gone). One dangling
      // invite must not take down the whole /me response for a user with
      // other, valid pending invites — clean it up and move on.
      console.error(`dangling invite for household ${householdId} (email ${normalized}); removing`, err);
      await docClient().send(
        new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: tableName(), Key: { PK: householdPk(householdId), SK: householdInviteSk(normalized) } } },
            { Delete: { TableName: tableName(), Key: { PK: invitePk(normalized), SK: householdPk(householdId) } } },
          ],
        }),
      );
      continue;
    }
    await docClient().send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: tableName(), Key: { PK: householdPk(householdId), SK: householdInviteSk(normalized) } } },
          { Delete: { TableName: tableName(), Key: { PK: invitePk(normalized), SK: householdPk(householdId) } } },
        ],
      }),
    );
  }
}
