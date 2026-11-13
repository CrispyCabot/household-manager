import type { Context, Hono } from 'hono';
import { type McpConfig, McpNotConfiguredError, mcpConfig, mcpResourceUrl } from './config.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const SCOPES = ['openid', 'email', 'profile'];

function config(c: Context): McpConfig | Response {
  try {
    return mcpConfig();
  } catch (err) {
    if (err instanceof McpNotConfiguredError) {
      console.error(err.message);
      return c.json({ error: 'temporarily_unavailable', error_description: 'Connector is not configured' }, 503);
    }
    throw err;
  }
}

function oauthError(c: Context, status: 400 | 401, error: string, description: string): Response {
  c.header('Cache-Control', 'no-store');
  return c.json({ error, error_description: description }, status);
}

export function registerOAuthRoutes(app: Hono<any>, fetchImpl: FetchLike = fetch): void {
  const protectedResource = (c: Context) => {
    const cfg = config(c);
    if (cfg instanceof Response) return cfg;
    return c.json({
      resource: mcpResourceUrl(cfg),
      authorization_servers: [cfg.apiOrigin],
      bearer_methods_supported: ['header'],
      scopes_supported: SCOPES,
      resource_name: 'household-manager',
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

  app.get('/.well-known/oauth-authorization-server', (c) => {
    const cfg = config(c);
    if (cfg instanceof Response) return cfg;
    return c.json({
      issuer: cfg.apiOrigin,
      authorization_endpoint: `${cfg.apiOrigin}/oauth/authorize`,
      token_endpoint: `${cfg.apiOrigin}/oauth/token`,
      registration_endpoint: `${cfg.apiOrigin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SCOPES,
    });
  });

  // Safe to share one public client: Cognito only redirects its codes to Claude's registered callbacks.
  app.post('/oauth/register', async (c) => {
    const cfg = config(c);
    if (cfg instanceof Response) return cfg;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return oauthError(c, 400, 'invalid_client_metadata', 'Body must be JSON');
    }
    const redirectUris = (body as { redirect_uris?: unknown }).redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === 'string' && isAllowedRedirect(u))) {
      return oauthError(c, 400, 'invalid_redirect_uri', 'redirect_uris must be a non-empty list of https (or loopback http) URLs');
    }
    const clientName = (body as { client_name?: unknown }).client_name;
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        client_id: cfg.clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        ...(typeof clientName === 'string' ? { client_name: clientName } : {}),
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: SCOPES.join(' '),
      },
      201,
    );
  });

  app.get('/oauth/authorize', (c) => {
    const cfg = config(c);
    if (cfg instanceof Response) return cfg;
    const q = c.req.query();
    if (q.client_id !== cfg.clientId) return oauthError(c, 400, 'invalid_client', 'Unknown client_id');
    if (q.response_type !== 'code') return oauthError(c, 400, 'unsupported_response_type', 'Only response_type=code is supported');
    if (q.redirect_uri === undefined || q.redirect_uri === '') return oauthError(c, 400, 'invalid_request', 'redirect_uri is required');
    if (q.code_challenge === undefined || q.code_challenge === '' || q.code_challenge_method !== 'S256') {
      return oauthError(c, 400, 'invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }

    const target = new URL(`${cfg.cognitoDomain}/oauth2/authorize`);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('client_id', cfg.clientId);
    target.searchParams.set('redirect_uri', q.redirect_uri);
    target.searchParams.set('scope', SCOPES.join(' '));
    target.searchParams.set('code_challenge', q.code_challenge);
    target.searchParams.set('code_challenge_method', 'S256');
    if (q.state !== undefined) target.searchParams.set('state', q.state);
    return c.redirect(target.toString(), 302);
  });

  app.post('/oauth/token', async (c) => {
    const cfg = config(c);
    if (cfg instanceof Response) return cfg;
    let form: Record<string, string>;
    try {
      const parsed = await c.req.parseBody();
      form = Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch {
      return oauthError(c, 400, 'invalid_request', 'Body must be application/x-www-form-urlencoded');
    }
    if (form.client_id !== undefined && form.client_id !== cfg.clientId) {
      return oauthError(c, 401, 'invalid_client', 'Unknown client_id');
    }

    const upstream = new URLSearchParams({ client_id: cfg.clientId });
    if (form.grant_type === 'authorization_code') {
      for (const key of ['code', 'redirect_uri', 'code_verifier'] as const) {
        const value = form[key];
        if (value === undefined || value === '') return oauthError(c, 400, 'invalid_request', `${key} is required`);
        upstream.set(key, value);
      }
      upstream.set('grant_type', 'authorization_code');
    } else if (form.grant_type === 'refresh_token') {
      const refreshToken = form.refresh_token;
      if (refreshToken === undefined || refreshToken === '') return oauthError(c, 400, 'invalid_request', 'refresh_token is required');
      upstream.set('grant_type', 'refresh_token');
      upstream.set('refresh_token', refreshToken);
    } else {
      return oauthError(c, 400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
    }

    const res = await fetchImpl(`${cfg.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: upstream.toString(),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    c.header('Cache-Control', 'no-store');
    if (!res.ok) {
      const error = typeof payload.error === 'string' ? payload.error : 'invalid_grant';
      return c.json({ error }, 400);
    }
    if (typeof payload.id_token !== 'string') {
      console.error('Cognito token response had no id_token');
      return c.json({ error: 'server_error' }, 502);
    }
    return c.json({
      // The API authenticates with ID tokens because it needs the email claim.
      access_token: payload.id_token,
      token_type: 'Bearer',
      expires_in: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
      ...(typeof payload.refresh_token === 'string' ? { refresh_token: payload.refresh_token } : {}),
      scope: SCOPES.join(' '),
    });
  });
}

function isAllowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}
