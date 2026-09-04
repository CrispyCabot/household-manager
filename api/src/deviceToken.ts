import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secretsClient = new SecretsManagerClient({});

// Cached at module scope — same lazy-fetch-once pattern as actionToken.ts.
// Deliberately its own secret, not a reuse of ACTION_TOKEN_SECRET_ARN:
// action tokens and device tokens authorize very different things (one
// email link vs. standing access to a household), so rotating one must
// never be able to invalidate — or, worse, silently keep valid — the other.
let cachedSecret: string | undefined;

async function secret(): Promise<string> {
  if (cachedSecret !== undefined) return cachedSecret;
  const arn = process.env.DEVICE_TOKEN_SECRET_ARN;
  if (arn === undefined || arn === '') throw new Error('DEVICE_TOKEN_SECRET_ARN is not set');
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }));
  if (result.SecretString === undefined || result.SecretString === '') {
    throw new Error('device token secret has no SecretString');
  }
  cachedSecret = result.SecretString;
  return cachedSecret;
}

async function hmac(body: string): Promise<string> {
  return createHmac('sha256', await secret()).update(body).digest('base64url');
}

export interface DeviceTokenPayload {
  deviceId: string;
  householdId: string;
  /** Unix seconds. */
  exp: number;
}

/**
 * Signs `{deviceId, householdId, exp}` into `<body>.<sig>` — a
 * self-contained, stateless capability with no server-side session store,
 * short-lived (see `DEVICE_TOKEN_TTL_SECONDS`) so a device just re-exchanges
 * its long-lived secret (see `hashDeviceSecret`) for a fresh one before each
 * expires. This is a two-segment string on purpose: `auth.ts`'s
 * `principalVerifier` tells this apart from a three-segment Cognito JWT by
 * counting dots, before either verifier's actual cryptographic check runs.
 */
export async function signDeviceToken(payload: DeviceTokenPayload): Promise<string> {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${await hmac(body)}`;
}

export const DEVICE_TOKEN_TTL_SECONDS = 15 * 60;

export class InvalidDeviceTokenError extends Error {}

/** Verifies the signature (constant-time) and expiry, then returns the payload. */
export async function verifyDeviceToken(token: string): Promise<DeviceTokenPayload> {
  const [body, sig] = token.split('.');
  if (body === undefined || sig === undefined || body === '' || sig === '') {
    throw new InvalidDeviceTokenError('malformed token');
  }

  const expectedSig = await hmac(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new InvalidDeviceTokenError('signature mismatch');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidDeviceTokenError('unparsable payload');
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as DeviceTokenPayload).deviceId !== 'string' ||
    typeof (payload as DeviceTokenPayload).householdId !== 'string' ||
    typeof (payload as DeviceTokenPayload).exp !== 'number'
  ) {
    throw new InvalidDeviceTokenError('malformed payload');
  }
  const typed = payload as DeviceTokenPayload;
  if (Date.now() / 1000 > typed.exp) {
    throw new InvalidDeviceTokenError('expired');
  }
  return typed;
}

// --- the device secret itself (long-lived, issued once at claim time) -----

/** 32 random bytes, url-safe — handed to a device exactly once, at claim time. */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only the hash is ever stored (`Device`'s `secretHash` — see
 * `db/devices.ts`) or compared; the plaintext secret exists in the API
 * process only for the instant it is generated or verified.
 */
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function deviceSecretMatches(candidate: string, storedHash: string): boolean {
  const candidateHash = Buffer.from(hashDeviceSecret(candidate));
  const stored = Buffer.from(storedHash);
  return candidateHash.length === stored.length && timingSafeEqual(candidateHash, stored);
}
