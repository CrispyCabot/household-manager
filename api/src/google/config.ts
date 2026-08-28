import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

// Cached at module scope — same lazy-fetch-once pattern as auth.ts's
// Cognito verifier and actionToken.ts's HMAC secret. Fetched as a JSON
// secret (`{"clientId": "...", "clientSecret": "..."}`), not baked into
// plaintext Lambda environment variables — consistent with how this app's
// other two secrets (ACTION_TOKEN_SECRET_ARN, DEVICE_TOKEN_SECRET_ARN) are
// handled, and unlike those two, this one CDK cannot generate itself: it
// comes from a Google Cloud Console OAuth client the operator creates by
// hand (FEATURE_ANALYSIS.md's Phase 2 console-setup steps) and pastes in
// after `cdk deploy` provisions an empty placeholder.
let cached: StoredCredentials | undefined;

export async function googleClientCredentials(): Promise<StoredCredentials> {
  if (cached !== undefined) return cached;
  const arn = process.env.GOOGLE_CLIENT_CREDENTIALS_SECRET_ARN;
  if (arn === undefined || arn === '') throw new Error('GOOGLE_CLIENT_CREDENTIALS_SECRET_ARN is not set');
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }));
  if (result.SecretString === undefined || result.SecretString === '') {
    throw new Error('google client credentials secret has no SecretString');
  }
  const parsed = JSON.parse(result.SecretString) as Partial<StoredCredentials>;
  if (parsed.clientId === undefined || parsed.clientSecret === undefined) {
    throw new Error(
      'google client credentials secret is missing clientId/clientSecret — has the placeholder been replaced with real values from Google Cloud Console yet?',
    );
  }
  cached = { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  return cached;
}

/**
 * Must exactly match a redirect URI configured on the Google Cloud Console
 * OAuth client (FEATURE_ANALYSIS.md's Phase 2 console-setup steps) — Google
 * rejects the exchange otherwise. `API_ORIGIN` is the API's own base URL
 * (e.g. `https://api.household-manager.chrisbridewell.dev`), set by
 * `infrastructure/lib/main-stack.ts` alongside the existing `WEB_ORIGIN`.
 */
export function googleRedirectUri(): string {
  const apiOrigin = process.env.API_ORIGIN;
  if (apiOrigin === undefined || apiOrigin === '') throw new Error('API_ORIGIN is not set');
  return `${apiOrigin}/v1/google/callback`;
}
