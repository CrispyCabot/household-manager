import { GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  InvalidRequestException,
  PutSecretValueCommand,
  ResourceExistsException,
  RestoreSecretCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { GOOGLE_SK, householdPk } from '@hhm/shared';
import type { GoogleConnection } from '@hhm/shared';
import { docClient, tableName } from './client.js';

let secretsClient: SecretsManagerClient | undefined;
function secrets(): SecretsManagerClient {
  secretsClient ??= new SecretsManagerClient({});
  return secretsClient;
}

/**
 * Dynamic, per-household secrets — unlike `ACTION_TOKEN_SECRET_ARN` and
 * `DEVICE_TOKEN_SECRET_ARN` (both fixed, CDK-provisioned once), one of
 * these is created the first time each household connects a Google
 * account. The IAM grant in `infrastructure/lib/main-stack.ts` scopes the
 * API Lambda's Secrets Manager permissions to exactly this name prefix.
 */
function secretName(householdId: string): string {
  return `household-manager/google/${householdId}`;
}

function fromItem(i: Record<string, unknown>): Omit<GoogleConnection, never> & { secretArn: string } {
  return {
    googleAccountEmail: String(i.googleAccountEmail),
    secretArn: String(i.secretArn),
    scopes: (i.scopes as string[] | undefined) ?? [],
    status: (i.status as GoogleConnection['status'] | undefined) ?? 'connected',
    connectedBy: String(i.connectedBy),
    connectedAt: String(i.connectedAt),
    lastRefreshedAt: (i.lastRefreshedAt as string | null | undefined) ?? null,
  };
}

/** Writes both the refresh token (Secrets Manager) and the connection's metadata (DynamoDB) — called once, at initial connect. */
export async function saveConnection(input: {
  householdId: string;
  googleAccountEmail: string;
  refreshToken: string;
  scopes: string[];
  connectedBy: string;
}): Promise<void> {
  const name = secretName(input.householdId);
  let secretArn: string;
  try {
    const created = await secrets().send(
      new CreateSecretCommand({ Name: name, Description: `Google refresh token for household ${input.householdId}`, SecretString: input.refreshToken }),
    );
    secretArn = created.ARN!;
  } catch (err) {
    if (err instanceof ResourceExistsException) {
      // A reconnect after a prior disconnect-without-cleanup, or a retried
      // request — reuse the existing secret rather than erroring.
      const updated = await secrets().send(new PutSecretValueCommand({ SecretId: name, SecretString: input.refreshToken }));
      secretArn = updated.ARN!;
    } else if (err instanceof InvalidRequestException && err.message.includes('scheduled for deletion')) {
      // deleteConnection's ForceDeleteWithoutRecovery isn't instantly
      // consistent on AWS's side — reconnecting fast enough after a
      // disconnect can land in the propagation window where the name is
      // still reserved by the just-deleted secret (observed directly:
      // ~4 minutes between a failed reconnect and it working on retry).
      // Cancelling the pending deletion and overwriting it is faster and
      // more reliable than making the user wait out an undocumented delay.
      await secrets().send(new RestoreSecretCommand({ SecretId: name }));
      const updated = await secrets().send(new PutSecretValueCommand({ SecretId: name, SecretString: input.refreshToken }));
      secretArn = updated.ARN!;
    } else {
      throw err;
    }
  }

  const now = new Date().toISOString();
  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: householdPk(input.householdId),
        SK: GOOGLE_SK,
        googleAccountEmail: input.googleAccountEmail,
        secretArn,
        scopes: input.scopes,
        status: 'connected',
        connectedBy: input.connectedBy,
        connectedAt: now,
        lastRefreshedAt: null,
      },
    }),
  );
}

/** Metadata only — never the refresh token. What the API returns to clients. */
export async function loadConnection(householdId: string): Promise<GoogleConnection | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: GOOGLE_SK } }),
  );
  if (result.Item === undefined) return null;
  const { secretArn: _secretArn, ...connection } = fromItem(result.Item);
  return connection;
}

/** Internal-only — the one place the refresh token is ever read back out. Never call this from a route handler directly; see `google/accessToken.ts`. */
export async function loadRefreshToken(householdId: string): Promise<string | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: GOOGLE_SK } }),
  );
  if (result.Item === undefined) return null;
  const { secretArn } = fromItem(result.Item);
  const secret = await secrets().send(new GetSecretValueCommand({ SecretId: secretArn }));
  return secret.SecretString ?? null;
}

export async function markNeedsReauth(householdId: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: GOOGLE_SK },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'needs_reauth' },
    }),
  );
}

export async function markRefreshed(householdId: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: GOOGLE_SK },
      UpdateExpression: 'SET lastRefreshedAt = :now, #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':now': new Date().toISOString(), ':status': 'connected' },
    }),
  );
}

export async function deleteConnection(householdId: string): Promise<boolean> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: GOOGLE_SK } }),
  );
  if (result.Item === undefined) return false;
  const { secretArn } = fromItem(result.Item);

  await docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: GOOGLE_SK } }));
  // Immediate, not the default 30-day recovery window — this is a revoked
  // OAuth grant, not data anyone would want to restore, and leaving it
  // recoverable just keeps billing for it (FEATURE_ANALYSIS.md's running-cost note).
  await secrets().send(new DeleteSecretCommand({ SecretId: secretArn, ForceDeleteWithoutRecovery: true }));
  return true;
}
