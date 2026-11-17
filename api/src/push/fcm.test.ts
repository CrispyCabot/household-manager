import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const secretMock = vi.fn<() => Promise<{ SecretString?: string }>>();

vi.mock('@aws-sdk/client-secrets-manager', () => {
  class SecretsManagerClient {
    send = () => secretMock();
  }
  class GetSecretValueCommand {
    constructor(public input: unknown) {}
  }
  return { SecretsManagerClient, GetSecretValueCommand };
});

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  project_id: 'hhm-test',
  client_email: 'push@hhm-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const message = { title: 'Take out trash', body: 'Due Jan 1', path: '/' };

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('sendPush', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_SECRET_ARN', 'arn:secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does nothing until the placeholder secret is replaced', async () => {
    secretMock.mockResolvedValue({ SecretString: '{"REPLACE_ME":"x"}' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { sendPush } = await import('./fcm.js');

    expect(await sendPush('phone', message)).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends to the project from the service account', async () => {
    secretMock.mockResolvedValue({ SecretString: JSON.stringify(account) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, { access_token: 'access', expires_in: 3600 }))
      .mockResolvedValueOnce(respond(200, { name: 'sent' }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendPush } = await import('./fcm.js');

    expect(await sendPush('phone', message)).toBe('sent');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/hhm-test/messages:send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access');
    expect(JSON.parse(String(init.body)).message.data).toEqual({ path: '/' });
  });

  it('sends reminders to the buzzing high priority channel', async () => {
    secretMock.mockResolvedValue({ SecretString: JSON.stringify(account) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, { access_token: 'access', expires_in: 3600 }))
      .mockResolvedValueOnce(respond(200, { name: 'sent' }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendPush } = await import('./fcm.js');

    await sendPush('phone', message);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const { android } = JSON.parse(String(init.body)).message;
    expect(android.priority).toBe('high');
    expect(android.notification).toMatchObject({ channel_id: 'task-reminders-buzz', default_sound: true });
    expect(android.notification.vibrate_timings.length).toBeGreaterThan(0);
  });

  it('reports a token Firebase no longer knows as stale', async () => {
    secretMock.mockResolvedValue({ SecretString: JSON.stringify(account) });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(respond(200, { access_token: 'access', expires_in: 3600 }))
        .mockResolvedValueOnce(respond(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })),
    );
    const { sendPush } = await import('./fcm.js');

    expect(await sendPush('phone', message)).toBe('stale');
  });
});
