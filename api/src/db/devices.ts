import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';
import { DEFAULT_SCHEDULE, DEVICE_SK_PREFIX, META, deviceSk, householdPk, pairPk } from '@hhm/shared';
import type { DashboardLayout, Device, ScheduleRule, Theme } from '@hhm/shared';
import { deviceSecretMatches, generateDeviceSecret, hashDeviceSecret } from '../deviceToken.js';
import { docClient, tableName } from './client.js';

function fromItem(i: Record<string, unknown>): Device {
  return {
    id: String(i.id),
    householdId: String(i.householdId),
    name: String(i.name),
    kind: 'dashboard',
    schedule: (i.schedule as ScheduleRule[] | undefined) ?? [],
    screensaverEnabled: Boolean(i.screensaverEnabled ?? false),
    screenWidth: (i.screenWidth as number | null | undefined) ?? null,
    screenHeight: (i.screenHeight as number | null | undefined) ?? null,
    layout: (i.layout as DashboardLayout | null | undefined) ?? null,
    theme: (i.theme as Theme | null | undefined) ?? null,
    lastSeenAt: (i.lastSeenAt as string | null | undefined) ?? null,
    lastSeenAgent: (i.lastSeenAgent as string | null | undefined) ?? null,
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
  };
}

// --- pairing -------------------------------------------------------------

const PAIRING_TTL_SECONDS = 10 * 60;
// No O/0/I/1 — unambiguous when read off a screen from across a room.
const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomPairCode(): string {
  // "XXXX-XXXX" from a 33-symbol alphabet is ~40 bits of entropy over a
  // 10-minute unauthenticated window — comfortably out of brute-force range
  // even before the endpoint's own rate limit (see FEATURE_ANALYSIS.md).
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => PAIR_CODE_ALPHABET[b % PAIR_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export async function createPairing(): Promise<{ code: string; expiresAt: string }> {
  const expiresAtMs = Date.now() + PAIRING_TTL_SECONDS * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const code = randomPairCode();

  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: pairPk(code), SK: META, code, expiresAt, ttl: Math.floor(expiresAtMs / 1000) },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  return { code, expiresAt };
}

export type PairPollResult =
  | { status: 'not_found' }
  | { status: 'pending' }
  | { status: 'claimed'; deviceId: string; householdId: string; deviceSecret: string };

/**
 * `expiresAt` is checked here explicitly rather than relied on via the
 * table's TTL attribute — DynamoDB deletes expired items on a best-effort
 * basis, typically within 48 hours, not at the instant they expire. TTL is
 * only a cleanup mechanism; this comparison is the actual expiry boundary.
 */
export async function pollPairing(code: string): Promise<PairPollResult> {
  const result = await docClient().send(new GetCommand({ TableName: tableName(), Key: { PK: pairPk(code), SK: META } }));
  const item = result.Item;
  if (item === undefined || new Date(String(item.expiresAt)).getTime() <= Date.now()) {
    return { status: 'not_found' };
  }
  if (item.deviceId === undefined) return { status: 'pending' };

  // Single-use delivery: the pairing record is deleted right after the
  // secret is read back, so a repeated poll after this point sees
  // "not_found" rather than the secret again. A second poll landing in the
  // same instant could still observe the secret before this delete lands —
  // an accepted, narrow race for a household-scale pairing flow.
  await docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: pairPk(code), SK: META } }));

  return {
    status: 'claimed',
    deviceId: String(item.deviceId),
    householdId: String(item.householdId),
    deviceSecret: String(item.deviceSecret),
  };
}

export async function claimPairing(input: {
  code: string;
  householdId: string;
  name: string;
  createdBy: string;
}): Promise<{ device: Device; deviceSecret: string } | null> {
  const now = new Date().toISOString();
  const device: Device = {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    name: input.name,
    kind: 'dashboard',
    schedule: DEFAULT_SCHEDULE,
    screensaverEnabled: false,
    screenWidth: null,
    screenHeight: null,
    layout: null,
    theme: null,
    lastSeenAt: null,
    lastSeenAgent: null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const deviceSecret = generateDeviceSecret();
  const secretHash = hashDeviceSecret(deviceSecret);

  try {
    await docClient().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName(),
              Item: { PK: householdPk(device.householdId), SK: deviceSk(device.id), ...device, secretHash },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Update: {
              TableName: tableName(),
              Key: { PK: pairPk(input.code), SK: META },
              UpdateExpression: 'SET deviceId = :did, deviceSecret = :secret, householdId = :hid',
              // Rejects a code that doesn't exist, was already claimed
              // (second tap of the same code), or has since expired —
              // collapsed to one "no longer valid" answer by the catch below.
              ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deviceId) AND expiresAt > :now',
              ExpressionAttributeValues: { ':did': device.id, ':secret': deviceSecret, ':hid': device.householdId, ':now': now },
            },
          },
        ],
      }),
    );
  } catch {
    return null;
  }

  return { device, deviceSecret };
}

// --- device credential & CRUD ---------------------------------------------

export async function verifyDeviceCredential(householdId: string, deviceId: string, deviceSecret: string): Promise<Device | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: deviceSk(deviceId) } }),
  );
  const item = result.Item;
  if (item === undefined || typeof item.secretHash !== 'string' || !deviceSecretMatches(deviceSecret, item.secretHash)) {
    return null;
  }
  return fromItem(item);
}

export async function touchDeviceLastSeen(householdId: string, deviceId: string, agent: string | null): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: deviceSk(deviceId) },
      UpdateExpression: 'SET lastSeenAt = :now, lastSeenAgent = :agent',
      ExpressionAttributeValues: { ':now': new Date().toISOString(), ':agent': agent },
    }),
  );
}

export async function listDevices(householdId: string): Promise<Device[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': DEVICE_SK_PREFIX },
    }),
  );
  return (result.Items ?? []).map(fromItem);
}

export async function loadDevice(householdId: string, deviceId: string): Promise<Device | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: deviceSk(deviceId) } }),
  );
  return result.Item === undefined ? null : fromItem(result.Item);
}

export interface UpdateDevicePatch {
  name?: string | undefined;
  schedule?: ScheduleRule[] | undefined;
  screensaverEnabled?: boolean | undefined;
  screenWidth?: number | null | undefined;
  screenHeight?: number | null | undefined;
  layout?: DashboardLayout | null | undefined;
  theme?: Theme | null | undefined;
}

export async function updateDevice(householdId: string, deviceId: string, patch: UpdateDevicePatch): Promise<Device | null> {
  const existing = await loadDevice(householdId, deviceId);
  if (existing === null) return null;

  const sets: string[] = ['updatedAt = :now'];
  const values: Record<string, unknown> = { ':now': new Date().toISOString() };
  const names: Record<string, string> = {};

  if (patch.name !== undefined) {
    sets.push('#name = :name');
    names['#name'] = 'name';
    values[':name'] = patch.name;
  }
  if (patch.schedule !== undefined) {
    sets.push('schedule = :schedule');
    values[':schedule'] = patch.schedule;
  }
  if (patch.screensaverEnabled !== undefined) {
    sets.push('screensaverEnabled = :screensaverEnabled');
    values[':screensaverEnabled'] = patch.screensaverEnabled;
  }
  if (patch.screenWidth !== undefined) {
    sets.push('screenWidth = :screenWidth');
    values[':screenWidth'] = patch.screenWidth;
  }
  if (patch.screenHeight !== undefined) {
    sets.push('screenHeight = :screenHeight');
    values[':screenHeight'] = patch.screenHeight;
  }
  if (patch.layout !== undefined) {
    sets.push('layout = :layout');
    values[':layout'] = patch.layout;
  }
  if (patch.theme !== undefined) {
    sets.push('theme = :theme');
    values[':theme'] = patch.theme;
  }

  const result = await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: deviceSk(deviceId) },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return fromItem(result.Attributes ?? {});
}

export async function deleteDevice(householdId: string, deviceId: string): Promise<boolean> {
  const existing = await loadDevice(householdId, deviceId);
  if (existing === null) return false;
  await docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: deviceSk(deviceId) } }));
  return true;
}
