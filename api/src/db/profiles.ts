import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PROFILE, userPk } from '@hhm/shared';
import { ClockSchema, NotificationChannelSchema, TextPhoneSchema, themeOf } from '@hhm/shared';
import { z } from 'zod';
import type { Clock, NotificationChannel, Profile, Theme } from '@hhm/shared';
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
      // `sub` is a DynamoDB reserved keyword and cannot appear unaliased in
      // an UpdateExpression -- this silently 500'd on every call before
      // being caught.
      UpdateExpression:
        'SET #sub = :sub, email = :email, lastHouseholdId = if_not_exists(lastHouseholdId, :null)',
      ExpressionAttributeNames: { '#sub': 'sub' },
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
    theme: themeOf(i.theme),
    notifyVia: notifyViaOf(i),
    clock: clockOf(i),
    textPhone: textPhoneOf(i),
    pendingTextPhone: textVerificationOf(i, new Date().toISOString())?.phone ?? null,
  };
}

const TextVerificationSchema = z.object({
  phone: TextPhoneSchema,
  codeHash: z.string(),
  expiresAt: z.string(),
  sentAt: z.string(),
  attempts: z.number(),
});
export type TextVerification = z.infer<typeof TextVerificationSchema>;

function textPhoneOf(item: Record<string, unknown>): string | null {
  return TextPhoneSchema.nullable().catch(null).parse(item.textPhone ?? null);
}

function textVerificationOf(item: Record<string, unknown>, nowIso: string): TextVerification | null {
  const parsed = TextVerificationSchema.safeParse(item.textVerification);
  return parsed.success && parsed.data.expiresAt > nowIso ? parsed.data : null;
}

async function profileItem(sub: string): Promise<Record<string, unknown>> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: PROFILE } }),
  );
  return result.Item ?? {};
}

export async function getTextPhone(sub: string): Promise<string | null> {
  return textPhoneOf(await profileItem(sub));
}

export async function getTextVerification(sub: string, nowIso: string): Promise<TextVerification | null> {
  return textVerificationOf(await profileItem(sub), nowIso);
}

export async function startTextVerification(sub: string, verification: TextVerification): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET textVerification = :v',
      ExpressionAttributeValues: { ':v': verification },
    }),
  );
}

export async function countTextVerificationAttempt(sub: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET textVerification.attempts = textVerification.attempts + :one',
      ConditionExpression: 'attribute_exists(textVerification)',
      ExpressionAttributeValues: { ':one': 1 },
    }),
  );
}

export async function confirmTextPhone(sub: string, phone: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET textPhone = :phone REMOVE textVerification',
      ExpressionAttributeValues: { ':phone': phone },
    }),
  );
}

export async function clearTextVerification(sub: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'REMOVE textVerification',
    }),
  );
}

export async function removeTextPhone(sub: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'REMOVE textPhone, textVerification',
    }),
  );
}

/** People who signed up before this setting existed keep getting email. */
function notifyViaOf(item: Record<string, unknown>): NotificationChannel {
  return NotificationChannelSchema.catch('email').parse(item.notifyVia);
}

function clockOf(item: Record<string, unknown>): Clock {
  return ClockSchema.catch('12h').parse(item.clock);
}

export async function getNotifyVia(sub: string): Promise<NotificationChannel> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: PROFILE } }),
  );
  return notifyViaOf(result.Item ?? {});
}

export async function setNotifyVia(sub: string, notifyVia: NotificationChannel): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET notifyVia = :via',
      ExpressionAttributeValues: { ':via': notifyVia },
    }),
  );
}

export async function getClock(sub: string): Promise<Clock> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: PROFILE } }),
  );
  return clockOf(result.Item ?? {});
}

export async function setClock(sub: string, clock: Clock): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET clock = :clock',
      ExpressionAttributeValues: { ':clock': clock },
    }),
  );
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

export async function setTheme(sub: string, theme: Theme | null): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET theme = :theme',
      ExpressionAttributeValues: { ':theme': theme },
    }),
  );
}
