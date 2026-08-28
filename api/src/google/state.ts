import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHmac, timingSafeEqual } from 'node:crypto';

const secretsClient = new SecretsManagerClient({});

/**
 * Signs the OAuth `state` param carrying a household id through Google's
 * consent redirect — reuses `ACTION_TOKEN_SECRET_ARN` rather than adding a
 * third HMAC secret: both this and the email action tokens are short-lived,
 * unrevokable-individually capability strings embedded in a URL, which is a
 * different threat shape from `DEVICE_TOKEN_SECRET_ARN`'s standing session
 * credential (see deviceToken.ts's doc comment on why *that* one is
 * separate). `/v1/google/callback` (routes/google.ts) is necessarily
 * unauthenticated — Google redirects the browser there directly — so this
 * signature is what stops a forged `state` from writing an OAuth
 * connection into an arbitrary household.
 */
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

async function hmac(body: string): Promise<string> {
  return createHmac('sha256', await secret()).update(body).digest('base64url');
}

const STATE_TTL_SECONDS = 10 * 60;

export interface OAuthState {
  householdId: string;
  /** The signed-in member who started the connect flow — carried here, not read from a session, because `/v1/google/callback` has none: Google redirects the browser there directly. */
  connectedBy: string;
}

export async function signOAuthState(input: OAuthState): Promise<string> {
  const payload = { ...input, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${await hmac(body)}`;
}

export class InvalidOAuthStateError extends Error {}

export async function verifyOAuthState(state: string): Promise<OAuthState> {
  const [body, sig] = state.split('.');
  if (body === undefined || sig === undefined || body === '' || sig === '') {
    throw new InvalidOAuthStateError('malformed state');
  }
  const expectedSig = await hmac(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new InvalidOAuthStateError('signature mismatch');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
    householdId?: unknown;
    connectedBy?: unknown;
    exp?: unknown;
  };
  if (typeof payload.householdId !== 'string' || typeof payload.connectedBy !== 'string' || typeof payload.exp !== 'number') {
    throw new InvalidOAuthStateError('malformed payload');
  }
  if (Date.now() / 1000 > payload.exp) {
    throw new InvalidOAuthStateError('expired');
  }
  return { householdId: payload.householdId, connectedBy: payload.connectedBy };
}
