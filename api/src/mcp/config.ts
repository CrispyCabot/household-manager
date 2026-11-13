/**
 * Where the Claude connector's OAuth facade (mcp/oauth.ts) sends people to
 * sign in, and which Cognito app client it signs them in as. Both are set
 * by CDK (infrastructure/lib/main-stack.ts) on the API Lambda.
 *
 * Read per call, not cached at module load, so tests can set them with
 * `vi.stubEnv` and so a missing value fails the one request that needs it
 * (with a clear message) rather than the whole Lambda at cold start.
 */
export interface McpConfig {
  /** Public origin of this API, e.g. `https://api.household-manager.chrisbridewell.dev`. The connector URL is this plus `/mcp`. */
  apiOrigin: string;
  /** The Cognito hosted UI, e.g. `https://<prefix>.auth.us-east-1.amazoncognito.com`. */
  cognitoDomain: string;
  /** The Cognito app client dedicated to the Claude connector (public client, PKCE). */
  clientId: string;
}

export class McpNotConfiguredError extends Error {}

export function mcpConfig(): McpConfig {
  const apiOrigin = process.env.API_ORIGIN ?? '';
  const cognitoDomain = process.env.COGNITO_DOMAIN ?? '';
  const clientId = process.env.MCP_CLIENT_ID ?? '';
  const missing = [
    ['API_ORIGIN', apiOrigin],
    ['COGNITO_DOMAIN', cognitoDomain],
    ['MCP_CLIENT_ID', clientId],
  ]
    .filter(([, v]) => v === '')
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new McpNotConfiguredError(`Claude connector is not configured: missing ${missing.join(', ')}`);
  }
  return { apiOrigin: stripSlash(apiOrigin), cognitoDomain: stripSlash(cognitoDomain), clientId };
}

function stripSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** The URL Claude is pointed at, and the `resource` advertised in the protected-resource metadata. */
export function mcpResourceUrl(config: McpConfig): string {
  return `${config.apiOrigin}/mcp`;
}

export function protectedResourceMetadataUrl(config: McpConfig): string {
  return `${config.apiOrigin}/.well-known/oauth-protected-resource`;
}
