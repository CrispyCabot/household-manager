import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { AuthedUser, Principal } from '../auth.js';
import type { TextVerification } from '../db/profiles.js';
import { type MeDb, defaultMeDb } from './me.js';

const TOKEN = 'user-token';
const user: AuthedUser = { kind: 'user', sub: 'user-1', email: 'a@example.com' };

async function verify(token: string): Promise<Principal> {
  if (token === TOKEN) return user;
  throw new Error('unknown token');
}

let pending: TextVerification | null;
let confirmed: string | null;
let lastText: { to: string; body: string } | null;
const sendText = vi.fn(async (to: string, body: string) => {
  lastText = { to, body };
});

function buildApp() {
  const meDb: MeDb = {
    ...defaultMeDb,
    getTextVerification: async () => pending,
    startTextVerification: async (_sub, v) => {
      pending = v;
    },
    countTextVerificationAttempt: async () => {
      if (pending !== null) pending = { ...pending, attempts: pending.attempts + 1 };
    },
    confirmTextPhone: async (_sub, phone) => {
      confirmed = phone;
      pending = null;
    },
    clearTextVerification: async () => {
      pending = null;
    },
    removeTextPhone: async () => {
      confirmed = null;
      pending = null;
    },
    sendText,
  };
  return createApp({ verify, meDb });
}

function call(method: string, path: string, body?: unknown) {
  return buildApp().request(path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const sentCode = () => /code is (\d{6})/.exec(lastText?.body ?? '')![1]!;

beforeEach(() => {
  pending = null;
  confirmed = null;
  lastText = null;
  sendText.mockClear();
});

describe('text message number', () => {
  it('texts a code to the normalized number and verifies it', async () => {
    expect((await call('PUT', '/v1/me/text-phone', { phone: '(859) 555-0123' })).status).toBe(204);
    expect(lastText?.to).toBe('+18595550123');

    expect((await call('POST', '/v1/me/text-phone/verify', { code: sentCode() })).status).toBe(204);
    expect(confirmed).toBe('+18595550123');
  });

  it('rejects a number outside the US and Canada', async () => {
    const res = await call('PUT', '/v1/me/text-phone', { phone: '+44 20 7946 0958' });
    expect(res.status).toBe(400);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('refuses a wrong code and locks after five tries', async () => {
    await call('PUT', '/v1/me/text-phone', { phone: '8595550123' });
    const wrong = sentCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/v1/me/text-phone/verify', { code: wrong })).status).toBe(400);
    }
    expect((await call('POST', '/v1/me/text-phone/verify', { code: sentCode() })).status).toBe(429);
    expect(confirmed).toBeNull();
  });

  it('does not resend a code within 30 seconds', async () => {
    await call('PUT', '/v1/me/text-phone', { phone: '8595550123' });
    expect((await call('PUT', '/v1/me/text-phone', { phone: '8595550123' })).status).toBe(429);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('reports texts as unavailable when sending fails, without keeping the pending code', async () => {
    sendText.mockRejectedValueOnce(new Error('no origination identity'));
    const res = await call('PUT', '/v1/me/text-phone', { phone: '8595550123' });
    expect(res.status).toBe(503);
    expect(pending).toBeNull();
  });

  it('drops an unverified number without touching the verified one', async () => {
    confirmed = '+18595550123';
    await call('PUT', '/v1/me/text-phone', { phone: '8595550999' });
    expect((await call('DELETE', '/v1/me/text-phone/pending')).status).toBe(204);
    expect(pending).toBeNull();
    expect(confirmed).toBe('+18595550123');
  });

  it('removes the number', async () => {
    confirmed = '+18595550123';
    expect((await call('DELETE', '/v1/me/text-phone')).status).toBe(204);
    expect(confirmed).toBeNull();
  });
});
