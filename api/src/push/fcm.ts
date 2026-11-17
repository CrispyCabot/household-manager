import { createSign } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

// Must match reminder_channel_id and REMINDER_VIBRATION in the Android app.
const REMINDER_CHANNEL_ID = 'task-reminders-buzz';
const REMINDER_VIBRATION = ['0s', '0.12s', '0.08s', '0.12s', '0.08s', '0.4s'];

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** In-app path the phone opens when the notification is tapped. */
  path: string;
}

/** `stale` means Firebase no longer knows the token (app uninstalled or data cleared), so it should be forgotten. */
export type PushResult = 'sent' | 'stale' | 'failed';

let serviceAccount: Promise<ServiceAccount | null> | undefined;
let accessToken: { value: string; expiresAt: number } | undefined;

/** Null until the operator pastes a Firebase service account key over the placeholder secret. */
async function loadServiceAccount(): Promise<ServiceAccount | null> {
  const arn = process.env.FIREBASE_SERVICE_ACCOUNT_SECRET_ARN;
  if (arn === undefined || arn === '') return null;
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }));
  const parsed = JSON.parse(result.SecretString ?? '{}') as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
  return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

async function fetchAccessToken(account: ServiceAccount): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (accessToken !== undefined && accessToken.expiresAt > nowSeconds + 60) return accessToken.value;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Firebase access token request failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: body.access_token, expiresAt: nowSeconds + body.expires_in };
  return accessToken.value;
}

export async function sendPush(token: string, message: PushMessage): Promise<PushResult> {
  serviceAccount ??= loadServiceAccount();
  const account = await serviceAccount;
  if (account === null) return 'failed';

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await fetchAccessToken(account)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: { path: message.path },
        android: {
          priority: 'high',
          notification: {
            channel_id: REMINDER_CHANNEL_ID,
            notification_priority: 'PRIORITY_HIGH',
            default_sound: true,
            vibrate_timings: REMINDER_VIBRATION,
          },
        },
      },
    }),
  });
  if (res.ok) return 'sent';
  const text = await res.text();
  if (res.status === 404 || text.includes('UNREGISTERED')) return 'stale';
  console.error(`push to a phone failed: ${res.status} ${text}`);
  return 'failed';
}
