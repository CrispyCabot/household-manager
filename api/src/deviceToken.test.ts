import { describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-secrets-manager', () => {
  class GetSecretValueCommand {
    constructor(readonly input: unknown) {}
  }
  class SecretsManagerClient {
    async send(_command: GetSecretValueCommand) {
      return { SecretString: 'test-device-token-secret' };
    }
  }
  return { GetSecretValueCommand, SecretsManagerClient };
});

process.env.DEVICE_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';

const { InvalidDeviceTokenError, signDeviceToken, verifyDeviceToken, generateDeviceSecret, hashDeviceSecret, deviceSecretMatches } = await import(
  './deviceToken.js'
);

describe('device tokens', () => {
  it('round-trips a signed token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = await signDeviceToken({ deviceId: 'dev1', householdId: 'hh1', exp });
    const payload = await verifyDeviceToken(token);
    expect(payload).toEqual({ deviceId: 'dev1', householdId: 'hh1', exp });
  });

  it('is a two-segment string, distinguishable from a three-segment JWT', async () => {
    const token = await signDeviceToken({ deviceId: 'dev1', householdId: 'hh1', exp: Math.floor(Date.now() / 1000) + 900 });
    expect(token.split('.').length).toBe(2);
  });

  it('rejects a tampered payload', async () => {
    const token = await signDeviceToken({ deviceId: 'dev1', householdId: 'hh1', exp: Math.floor(Date.now() / 1000) + 900 });
    const [body, sig] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ deviceId: 'attacker', householdId: 'hh1', exp: Math.floor(Date.now() / 1000) + 900 })).toString(
      'base64url',
    );
    await expect(verifyDeviceToken(`${tamperedBody}.${sig}`)).rejects.toBeInstanceOf(InvalidDeviceTokenError);
  });

  it('rejects a tampered signature', async () => {
    const token = await signDeviceToken({ deviceId: 'dev1', householdId: 'hh1', exp: Math.floor(Date.now() / 1000) + 900 });
    const [body] = token.split('.');
    await expect(verifyDeviceToken(`${body}.not-the-real-signature`)).rejects.toBeInstanceOf(InvalidDeviceTokenError);
  });

  it('rejects an expired token', async () => {
    const token = await signDeviceToken({ deviceId: 'dev1', householdId: 'hh1', exp: Math.floor(Date.now() / 1000) - 1 });
    await expect(verifyDeviceToken(token)).rejects.toBeInstanceOf(InvalidDeviceTokenError);
  });

  it('rejects a malformed token', async () => {
    await expect(verifyDeviceToken('not-a-valid-token')).rejects.toBeInstanceOf(InvalidDeviceTokenError);
  });
});

describe('device secrets', () => {
  it('generates a secret whose hash verifies against itself', () => {
    const secret = generateDeviceSecret();
    const hash = hashDeviceSecret(secret);
    expect(deviceSecretMatches(secret, hash)).toBe(true);
  });

  it('rejects the wrong secret', () => {
    const hash = hashDeviceSecret(generateDeviceSecret());
    expect(deviceSecretMatches(generateDeviceSecret(), hash)).toBe(false);
  });

  it('generates secrets that differ each time', () => {
    expect(generateDeviceSecret()).not.toBe(generateDeviceSecret());
  });
});
