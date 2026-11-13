import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { FetchLike } from './oauth.js';

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', 'https://api.example.test');
  vi.stubEnv('COGNITO_DOMAIN', 'https://login.example.test');
  vi.stubEnv('MCP_CLIENT_ID', 'mcp-client');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const verify = async () => {
  throw new Error('not used');
};

function form(values: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() };
}

describe('discovery', () => {
  it('serves protected-resource metadata naming this API as the authorization server', async () => {
    const app = createApp({ verify });
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        resource: 'https://api.example.test/mcp',
        authorization_servers: ['https://api.example.test'],
      });
    }
  });

  it('serves authorization-server metadata with PKCE and registration', async () => {
    const res = await createApp({ verify }).request('/.well-known/oauth-authorization-server');
    expect(await res.json()).toMatchObject({
      issuer: 'https://api.example.test',
      authorization_endpoint: 'https://api.example.test/oauth/authorize',
      token_endpoint: 'https://api.example.test/oauth/token',
      registration_endpoint: 'https://api.example.test/oauth/register',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  it('fails clearly when the connector is not configured', async () => {
    vi.stubEnv('MCP_CLIENT_ID', '');
    const res = await createApp({ verify }).request('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(503);
  });
});

describe('/oauth/register', () => {
  it('hands out the one public connector client', async () => {
    const res = await createApp({ verify }).request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      client_id: 'mcp-client',
      token_endpoint_auth_method: 'none',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    });
  });

  it('rejects a non-https redirect', async () => {
    const res = await createApp({ verify }).request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('/oauth/authorize', () => {
  const base = {
    response_type: 'code',
    client_id: 'mcp-client',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    state: 'xyz',
    code_challenge: 'challenge',
    code_challenge_method: 'S256',
    resource: 'https://api.example.test/mcp',
    scope: 'whatever',
  };

  it('redirects to the Cognito hosted UI, dropping the resource indicator and fixing the scopes', async () => {
    const res = await createApp({ verify }).request(`/oauth/authorize?${new URLSearchParams(base)}`);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('https://login.example.test/oauth2/authorize');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'mcp-client',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      scope: 'openid email profile',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      state: 'xyz',
    });
  });

  it('refuses another client id', async () => {
    const res = await createApp({ verify }).request(`/oauth/authorize?${new URLSearchParams({ ...base, client_id: 'web-client' })}`);
    expect(res.status).toBe(400);
  });

  it('requires S256 PKCE', async () => {
    const res = await createApp({ verify }).request(`/oauth/authorize?${new URLSearchParams({ ...base, code_challenge_method: 'plain' })}`);
    expect(res.status).toBe(400);
  });
});

describe('/oauth/token', () => {
  function cognitoReturning(status: number, body: unknown) {
    return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  }

  it('exchanges a code with Cognito and returns the ID token as the access token', async () => {
    const oauthFetch = cognitoReturning(200, { id_token: 'ID', access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600, token_type: 'Bearer' });
    const res = await createApp({ verify, oauthFetch }).request(
      '/oauth/token',
      form({
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: 'mcp-client',
        resource: 'https://api.example.test/mcp',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ access_token: 'ID', token_type: 'Bearer', expires_in: 3600, refresh_token: 'REFRESH', scope: 'openid email profile' });

    const [url, init] = oauthFetch.mock.calls[0]!;
    expect(url).toBe('https://login.example.test/oauth2/token');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: 'mcp-client',
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_verifier: 'verifier',
    });
  });

  it('refreshes, keeping no refresh token in the response when Cognito returns none', async () => {
    const oauthFetch = cognitoReturning(200, { id_token: 'ID2', access_token: 'A2', expires_in: 3600 });
    const res = await createApp({ verify, oauthFetch }).request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: 'REFRESH' }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.access_token).toBe('ID2');
    expect(body).not.toHaveProperty('refresh_token');
  });

  it("passes Cognito's OAuth error through", async () => {
    const oauthFetch = cognitoReturning(400, { error: 'invalid_grant' });
    const res = await createApp({ verify, oauthFetch }).request(
      '/oauth/token',
      form({ grant_type: 'authorization_code', code: 'bad', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: 'v' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects a missing PKCE verifier without calling Cognito', async () => {
    const oauthFetch = cognitoReturning(200, {});
    const res = await createApp({ verify, oauthFetch }).request(
      '/oauth/token',
      form({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://claude.ai/api/mcp/auth_callback' }),
    );
    expect(res.status).toBe(400);
    expect(oauthFetch).not.toHaveBeenCalled();
  });
});
