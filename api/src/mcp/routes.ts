import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context, Hono } from 'hono';
import type { PrincipalVerifier } from '../auth.js';
import { McpNotConfiguredError, mcpConfig, protectedResourceMetadataUrl } from './config.js';
import { type ApiCaller, createMcpServer } from './server.js';

/** Hands a request to this same Hono app, in-process — see `createMcpServer`'s doc comment. */
export type Dispatch = (request: Request) => Response | Promise<Response>;

/**
 * The 401 MCP clients key on: `resource_metadata` tells Claude where the
 * protected-resource document is (mcp/oauth.ts), which starts its OAuth
 * sign-in.
 */
function unauthorized(c: Context, description: string, tokenPresented = true): Response {
  // RFC 6750 §3.1: a request that carried no token at all gets no error code.
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

/**
 * `POST /mcp` — the Claude connector endpoint (MCP Streamable HTTP).
 *
 * Stateless: a fresh server and transport per request, JSON responses
 * rather than SSE, no session ids. That fits a Lambda behind API Gateway,
 * which neither keeps state between invocations nor holds a stream open,
 * and none of the tools need server-to-client notifications. `GET`
 * (the optional SSE stream) and `DELETE` (session teardown) therefore
 * answer 405, which the spec allows.
 *
 * Auth is a signed-in household member's token, same verifier as the REST
 * API. Device tokens are refused: a wall dashboard has no business here.
 */
export function registerMcpRoutes(app: Hono<any>, verify: PrincipalVerifier, dispatch: Dispatch): void {
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

    // No sessionIdGenerator: that is what makes the transport stateless.
    const server = createMcpServer(api);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
}
