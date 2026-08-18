import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHmac, timingSafeEqual } from 'node:crypto';

const secretsClient = new SecretsManagerClient({});

// Cached at module scope — same lazy-fetch-once pattern as auth.ts's Cognito
// verifier. A Lambda container reuses this across invocations, so the
// secret is fetched from Secrets Manager at most once per cold start.
let cachedSecret: string | undefined;

async function secret(): Promise<string> {
  if (cachedSecret !== undefined) return cachedSecret;
  const arn = process.env.ACTION_TOKEN_SECRET_ARN;
  if (arn === undefined || arn === '') throw new Error('ACTION_TOKEN_SECRET_ARN is not set');
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }));
  if (result.SecretString === undefined || result.SecretString === '') {
    throw new Error('action token secret has no SecretString');
  }
  cachedSecret = result.SecretString;
  return cachedSecret;
}

export type TaskAction = 'complete' | 'snooze' | 'dismiss';

export interface ActionTokenPayload {
  householdId: string;
  boardId: string;
  taskId: string;
  action: TaskAction;
  /** Unix seconds. */
  exp: number;
}

async function hmac(body: string): Promise<string> {
  return createHmac('sha256', await secret()).update(body).digest('base64url');
}

/**
 * Signs `{householdId, boardId, taskId, action, exp}` into `<body>.<sig>` —
 * a self-contained, stateless capability: whoever holds a valid token is
 * authorized to perform exactly that one action on exactly that one task,
 * until it expires. No server-side token store, so nothing here can revoke
 * a single token early or enforce single-use; see verifyActionToken's note
 * on why that's an acceptable trade for this app.
 */
export async function signActionToken(payload: ActionTokenPayload): Promise<string> {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${await hmac(body)}`;
}

export class InvalidActionTokenError extends Error {}

/**
 * Verifies the signature (constant-time comparison — a timing side-channel
 * here would let an attacker learn the correct signature one byte at a
 * time) and expiry, then returns the payload.
 *
 * Replay isn't otherwise prevented: the same link can be clicked more than
 * once until it expires. That's deliberately accepted rather than adding a
 * consumed-token table — every action this signs is idempotent-safe
 * (completing an already-completed task, re-dismissing, or re-snoozing are
 * all harmless no-ops/overwrites), and the worst case of a leaked link is
 * "a household member's own task gets marked done/snoozed/dismissed early"
 * — low severity for a personal household app.
 */
export async function verifyActionToken(token: string): Promise<ActionTokenPayload> {
  const [body, sig] = token.split('.');
  if (body === undefined || sig === undefined || body === '' || sig === '') {
    throw new InvalidActionTokenError('malformed token');
  }

  const expectedSig = await hmac(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new InvalidActionTokenError('signature mismatch');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidActionTokenError('unparsable payload');
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as ActionTokenPayload).householdId !== 'string' ||
    typeof (payload as ActionTokenPayload).boardId !== 'string' ||
    typeof (payload as ActionTokenPayload).taskId !== 'string' ||
    typeof (payload as ActionTokenPayload).exp !== 'number'
  ) {
    throw new InvalidActionTokenError('malformed payload');
  }
  const typed = payload as ActionTokenPayload;
  if (typed.action !== 'complete' && typed.action !== 'snooze' && typed.action !== 'dismiss') {
    throw new InvalidActionTokenError('unknown action');
  }
  if (Date.now() / 1000 > typed.exp) {
    throw new InvalidActionTokenError('expired');
  }
  return typed;
}
