import { describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-secrets-manager', () => {
  class GetSecretValueCommand {
    constructor(readonly input: unknown) {}
  }
  class SecretsManagerClient {
    async send(_command: GetSecretValueCommand) {
      return { SecretString: 'test-action-token-secret' };
    }
  }
  return { GetSecretValueCommand, SecretsManagerClient };
});

process.env.ACTION_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';

const { InvalidOAuthStateError, signOAuthState, verifyOAuthState } = await import('./state.js');

describe('OAuth state', () => {
  it('round-trips householdId and connectedBy', async () => {
    const state = await signOAuthState({ householdId: 'hh-1', connectedBy: 'user-sub-1' });
    const payload = await verifyOAuthState(state);
    expect(payload).toEqual({ householdId: 'hh-1', connectedBy: 'user-sub-1' });
  });

  it('rejects a tampered householdId', async () => {
    const state = await signOAuthState({ householdId: 'hh-1', connectedBy: 'user-sub-1' });
    const [body, sig] = state.split('.');
    const tamperedBody = Buffer.from(
      JSON.stringify({ householdId: 'attacker-household', connectedBy: 'user-sub-1', exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString('base64url');
    await expect(verifyOAuthState(`${tamperedBody}.${sig}`)).rejects.toBeInstanceOf(InvalidOAuthStateError);
  });

  it('rejects a malformed state', async () => {
    await expect(verifyOAuthState('not-a-valid-state')).rejects.toBeInstanceOf(InvalidOAuthStateError);
  });

  it('rejects an expired state', async () => {
    // Sign a state, then tamper only its exp forward in time isn't possible
    // without invalidating the signature — instead, verify the real
    // expiry boundary via a state signed to have already expired by hand.
    const body = Buffer.from(JSON.stringify({ householdId: 'hh-1', connectedBy: 'user-sub-1', exp: Math.floor(Date.now() / 1000) - 1 })).toString(
      'base64url',
    );
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', 'test-action-token-secret').update(body).digest('base64url');
    await expect(verifyOAuthState(`${body}.${sig}`)).rejects.toBeInstanceOf(InvalidOAuthStateError);
  });
});
