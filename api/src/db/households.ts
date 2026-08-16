import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { INVITE_SK_PREFIX, META, householdPk, invitePk, memberSk, userPk } from '@hhm/shared';
import type { Household, HouseholdSummary, Member } from '@hhm/shared';
import { docClient, tableName } from './client.js';

/** Raised when a conditional write loses — another writer got there first. */
export class VersionConflictError extends Error {
  constructor() {
    super('The household was modified by someone else');
    this.name = 'VersionConflictError';
  }
}

export async function createHousehold(input: {
  creatorSub: string;
  creatorEmail: string;
  name: string;
}): Promise<Household> {
  const now = new Date().toISOString();
  const household: Household = {
    id: crypto.randomUUID(),
    name: input.name,
    createdBy: input.creatorSub,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  // Three items, one transaction: a household never exists without also
  // being a member's household and appearing in the creator's switcher.
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { PK: householdPk(household.id), SK: META, ...household },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              PK: householdPk(household.id),
              SK: memberSk(input.creatorSub),
              sub: input.creatorSub,
              email: input.creatorEmail,
              joinedAt: now,
            },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              PK: userPk(input.creatorSub),
              SK: householdPk(household.id),
              id: household.id,
              name: household.name,
            },
          },
        },
      ],
    }),
  );

  return household;
}

export async function listHouseholdsForUser(sub: string): Promise<HouseholdSummary[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': userPk(sub), ':sk': 'HH#' },
    }),
  );
  return (result.Items ?? []).map((i) => ({ id: String(i.id), name: String(i.name) }));
}

/** True membership check. Every route scoped to `:hid` calls this first (see middleware/household.ts). */
export async function isMember(householdId: string, sub: string): Promise<boolean> {
  const result = await docClient().send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: memberSk(sub) },
    }),
  );
  return result.Item !== undefined;
}

export async function loadHousehold(householdId: string): Promise<Household | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: META } }),
  );
  if (result.Item === undefined) return null;
  const i = result.Item;
  return {
    id: String(i.id),
    name: String(i.name),
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
    version: Number(i.version),
  };
}

export async function listMembers(householdId: string): Promise<Member[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'MEMBER#' },
    }),
  );
  return (result.Items ?? []).map((i) => ({
    sub: String(i.sub),
    email: String(i.email),
    joinedAt: String(i.joinedAt),
  }));
}

export async function renameHousehold(
  householdId: string,
  name: string,
  expectedVersion: number,
): Promise<Household> {
  try {
    const result = await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(householdId), SK: META },
        UpdateExpression: 'SET #name = :name, updatedAt = :now, version = :next',
        ConditionExpression: 'version = :expected',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':name': name,
          ':now': new Date().toISOString(),
          ':next': expectedVersion + 1,
          ':expected': expectedVersion,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const a = result.Attributes ?? {};
    return {
      id: String(a.id),
      name: String(a.name),
      createdBy: String(a.createdBy),
      createdAt: String(a.createdAt),
      updatedAt: String(a.updatedAt),
      version: Number(a.version),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      throw new VersionConflictError();
    }
    throw err;
  }
}

/** Creator-only restriction is enforced by the caller (routes/households.ts), not here. */
export async function deleteHousehold(householdId: string): Promise<void> {
  const members = await listMembers(householdId);
  const items = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': householdPk(householdId) },
    }),
  );

  const itemDeletions = (items.Items ?? []).map((item) =>
    docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: item.PK, SK: item.SK } })),
  );
  const membershipDeletions = members.map((m) =>
    docClient().send(
      new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(m.sub), SK: householdPk(householdId) } }),
    ),
  );
  // Each household-side invite (SK: INVITE#<email>) has a mirror item in the
  // invitee's own partition (PK: INVITE#<email>, SK: HH#<householdId>) — see
  // packages/shared/src/keys.ts. Without deleting that mirror too, it
  // outlives the household it points at and claimInvites finds a dangling
  // reference on every future GET /v1/me for that invitee.
  const inviteMirrorDeletions = (items.Items ?? [])
    .filter((item) => typeof item.SK === 'string' && item.SK.startsWith(INVITE_SK_PREFIX))
    .map((item) => {
      const email = String(item.SK).slice(INVITE_SK_PREFIX.length);
      return docClient().send(
        new DeleteCommand({ TableName: tableName(), Key: { PK: invitePk(email), SK: householdPk(householdId) } }),
      );
    });

  await Promise.all([...itemDeletions, ...membershipDeletions, ...inviteMirrorDeletions]);
}

export async function addMember(householdId: string, sub: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  const household = await loadHousehold(householdId);
  if (household === null) throw new Error(`household ${householdId} does not exist`);

  // Member + membership, transactionally — the pairing invariant applies to
  // every write that adds someone, not only to household creation.
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { PK: householdPk(householdId), SK: memberSk(sub), sub, email, joinedAt: now },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: { PK: userPk(sub), SK: householdPk(householdId), id: householdId, name: household.name },
          },
        },
      ],
    }),
  );
}

export async function removeMember(householdId: string, sub: string): Promise<void> {
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: tableName(), Key: { PK: householdPk(householdId), SK: memberSk(sub) } } },
        { Delete: { TableName: tableName(), Key: { PK: userPk(sub), SK: householdPk(householdId) } } },
      ],
    }),
  );
}
