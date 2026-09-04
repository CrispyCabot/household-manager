import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleReauthRequiredError, buildAuthUrl, exchangeCodeForTokens, refreshAccessToken } from './oauth.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.fake-signature`;
}

describe('buildAuthUrl', () => {
  it('requests offline access and forces the consent prompt', () => {
    const url = new URL(buildAuthUrl({ clientId: 'client-1', redirectUri: 'https://api.example.com/v1/google/callback', state: 'signed-state' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    // Regression check for the missing-scope bug found testing this for
    // real: calendar.events alone can't list which calendars exist.
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
  });
});

describe('exchangeCodeForTokens', () => {
  it('decodes the email claim off the ID token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          expires_in: 3600,
          refresh_token: 'refresh-1',
          id_token: fakeIdToken({ email: 'household@example.com' }),
          scope: 'openid email https://www.googleapis.com/auth/calendar.events',
        }),
      })),
    );

    const result = await exchangeCodeForTokens({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback', code: 'auth-code' });
    expect(result.email).toBe('household@example.com');
    expect(result.refreshToken).toBe('refresh-1');
    expect(result.scopes).toContain('https://www.googleapis.com/auth/calendar.events');
  });

  it('returns a null refreshToken when Google omits one, rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          expires_in: 3600,
          id_token: fakeIdToken({ email: 'household@example.com' }),
          scope: 'openid email',
        }),
      })),
    );
    const result = await exchangeCodeForTokens({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback', code: 'auth-code' });
    expect(result.refreshToken).toBeNull();
  });

  it('throws when Google returns no ID token at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'a', expires_in: 3600, scope: 'openid' }) })),
    );
    await expect(exchangeCodeForTokens({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback', code: 'bad' })).rejects.toThrow(
      /no email claim/,
    );
  });
});

describe('refreshAccessToken', () => {
  it('throws GoogleReauthRequiredError on a 400/401, not a generic error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' })));
    await expect(refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'revoked' })).rejects.toBeInstanceOf(
      GoogleReauthRequiredError,
    );
  });

  it('throws a generic error on an unrelated failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => 'try again' })));
    await expect(refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'x' })).rejects.not.toBeInstanceOf(
      GoogleReauthRequiredError,
    );
  });

  it('returns a fresh access token on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'new-token', expires_in: 3600, scope: '' }) })));
    const result = await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'x' });
    expect(result.accessToken).toBe('new-token');
  });
});
