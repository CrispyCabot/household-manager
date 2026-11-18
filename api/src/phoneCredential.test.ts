import { describe, expect, it, vi } from 'vitest';
import { PHONE_CREDENTIAL_PREFIX, isPhoneCredential, verifyPhoneCredential } from './phoneCredential.js';

const credential = (value: unknown) => PHONE_CREDENTIAL_PREFIX + Buffer.from(JSON.stringify(value)).toString('base64url');

describe('phone credentials', () => {
  it('is told apart from Cognito and device tokens', () => {
    expect(isPhoneCredential(credential({ sub: 'u', token: 't' }))).toBe(true);
    expect(isPhoneCredential('a.b.c')).toBe(false);
    expect(isPhoneCredential('a.b')).toBe(false);
  });

  it('acts as the member whose phone is still registered', async () => {
    const isRegistered = vi.fn(async () => true);
    expect(await verifyPhoneCredential(credential({ sub: 'user-1', token: 'fcm:abc' }), isRegistered)).toEqual({ sub: 'user-1' });
    expect(isRegistered).toHaveBeenCalledWith('user-1', 'fcm:abc');
  });

  it('is refused once the phone is unregistered', async () => {
    await expect(verifyPhoneCredential(credential({ sub: 'user-1', token: 'fcm:abc' }), async () => false)).rejects.toThrow();
  });

  it('is refused when malformed', async () => {
    await expect(verifyPhoneCredential(credential({ sub: 'user-1' }), async () => true)).rejects.toThrow();
    await expect(verifyPhoneCredential(`${PHONE_CREDENTIAL_PREFIX}not-json`, async () => true)).rejects.toThrow();
  });
});
