import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context, Hono } from 'hono';
import type { PrincipalVerifier } from '../auth.js';
import { McpNotConfiguredError, mcpConfig, protectedResourceMetadataUrl } from './config.js';
import { type ApiCaller, createMcpServer } from './server.js';

export type InProcessDispatch = (request: Request) => Response | Promise<Response>;

function unauthorized(c: Context, description: string, tokenPresented = true): Response {
  let challenge = tokenPresented ? `Bearer error="invalid_token", error_description="${description}"` : 'Bearer realm="household-manager"';
  try {
    challenge += `, resource_metadata="${protectedResourceMetadataUrl(mcpConfig())}"`;
  } catch (err) {
    if (!(err instanceof McpNotConfiguredError)) throw err;
    console.error(err.message);
  }
  c.header('WWW-Authenticate', challenge);
  return c.json({ error: { code: 'unauthorized', message: description } }, 401);
}

export function registerMcpRoutes(app: Hono<any>, verify: PrincipalVerifier, dispatch: InProcessDispatch): void {
  app.all('/mcp', async (c) => {
    const header = c.req.header('Authorization');
    if (header === undefined || !header.startsWith('Bearer ')) return unauthorized(c, 'Missing bearer token', false);
    try {
      const principal = await verify(header.slice('Bearer '.length));
      if (principal.kind !== 'user') return unauthorized(c, 'A household member must sign in');
    } catch {
      return unauthorized(c, 'Invalid or expired token');
    }

    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST');
      return c.json({ error: { code: 'method_not_allowed', message: 'This server is stateless; use POST' } }, 405);
    }

    const api: ApiCaller = (path, init = {}) =>
      Promise.resolve(
        dispatch(
          new Request(`http://in-process${path}`, {
            method: init.method ?? 'GET',
            headers: { Authorization: header, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          }),
        ),
      );

    const server = createMcpServer(api);
    const statelessTransport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(statelessTransport);
    try {
      return await statelessTransport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
}
