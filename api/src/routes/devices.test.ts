import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { AuthedUser, Principal } from '../auth.js';
import type { DeviceDb } from './devices.js';
import type { Device } from '@hhm/shared';

vi.mock('../deviceToken.js', async () => {
  const actual = await vi.importActual<typeof import('../deviceToken.js')>('../deviceToken.js');
  return {
    ...actual,
    signDeviceToken: vi.fn(async (payload: unknown) => `signed.${JSON.stringify(payload)}`),
  };
});

const HID = 'hh-1';
const DID = 'dv-1';
const userPrincipal: AuthedUser = { kind: 'user', sub: 'user-sub', email: 'a@example.com' };
const USER_TOKEN = 'user-token';

async function verify(token: string): Promise<Principal> {
  if (token === USER_TOKEN) return userPrincipal;
  throw new Error('unknown test token');
}

const now = new Date().toISOString();
const fakeDevice: Device = {
  id: DID,
  householdId: HID,
  name: 'Kitchen',
  kind: 'dashboard',
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', mode: 'on' }],
  screensaverEnabled: false,
  layout: null,
  theme: null,
  lastSeenAt: null,
  lastSeenAgent: null,
  createdBy: userPrincipal.sub,
  createdAt: now,
  updatedAt: now,
};

function buildApp(deviceDb: Partial<DeviceDb>) {
  const fullDeviceDb: DeviceDb = {
    createPairing: async () => ({ code: 'ABCD-1234', expiresAt: now }),
    pollPairing: async () => ({ status: 'not_found' as const }),
    claimPairing: async () => null,
    verifyDeviceCredential: async () => null,
    touchDeviceLastSeen: async () => {},
    listDevices: async () => [],
    loadDevice: async () => null,
    updateDevice: async () => null,
    deleteDevice: async () => false,
    ...deviceDb,
  };
  return createApp({ verify, checkMembership: async () => true, deviceDb: fullDeviceDb });
}

describe('pairing lifecycle', () => {
  it('creates a pairing code', async () => {
    const app = buildApp({});
    const res = await app.request('/v1/devices/pair', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ code: 'ABCD-1234', expiresAt: now });
  });

  it('reports pending while unclaimed', async () => {
    const app = buildApp({ pollPairing: async () => ({ status: 'pending' }) });
    const res = await app.request('/v1/devices/pair/ABCD-1234');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('404s an unknown or expired code', async () => {
    const app = buildApp({ pollPairing: async () => ({ status: 'not_found' }) });
    const res = await app.request('/v1/devices/pair/NOPE-0000');
    expect(res.status).toBe(404);
  });

  it('delivers the device secret exactly once, when claimed', async () => {
    const app = buildApp({
      pollPairing: async () => ({ status: 'claimed', deviceId: DID, householdId: HID, deviceSecret: 'top-secret' }),
    });
    const res = await app.request('/v1/devices/pair/ABCD-1234');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'claimed', deviceId: DID, householdId: HID, deviceSecret: 'top-secret' });
  });

  it('claiming a bad code returns 404, not a device object', async () => {
    const app = buildApp({ claimPairing: async () => null });
    const res = await app.request(`/v1/households/${HID}/devices/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'WRONG-CODE', name: 'Kitchen' }),
    });
    expect(res.status).toBe(404);
  });

  it('a successful claim never echoes the device secret back to the claiming user', async () => {
    const app = buildApp({ claimPairing: async () => ({ device: fakeDevice, deviceSecret: 'must-not-leak' }) });
    const res = await app.request(`/v1/households/${HID}/devices/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD-1234', name: 'Kitchen' }),
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('must-not-leak');
    expect(JSON.parse(text)).toEqual({ device: fakeDevice });
  });
});

describe('token exchange', () => {
  it('issues a token for a valid credential', async () => {
    const app = buildApp({ verifyDeviceCredential: async () => fakeDevice });
    const res = await app.request('/v1/devices/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DID, householdId: HID, deviceSecret: 'correct' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresIn: number };
    expect(body.expiresIn).toBe(15 * 60);
    expect(typeof body.token).toBe('string');
  });

  it('rejects a wrong secret with 401, not 404 or 500', async () => {
    const app = buildApp({ verifyDeviceCredential: async () => null });
    const res = await app.request('/v1/devices/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DID, householdId: HID, deviceSecret: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('touches last-seen on a successful exchange', async () => {
    const touchDeviceLastSeen = vi.fn(async () => {});
    const app = buildApp({ verifyDeviceCredential: async () => fakeDevice, touchDeviceLastSeen });
    await app.request('/v1/devices/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DID, householdId: HID, deviceSecret: 'correct' }),
    });
    // No User-Agent header was sent, so the agent argument is null — real
    // clients (browser or Pi agent) always send one; this exercises the
    // no-header edge case explicitly rather than leaving it unverified.
    expect(touchDeviceLastSeen).toHaveBeenCalledWith(HID, DID, null);
  });
});
