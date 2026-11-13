export interface McpConfig {
  apiOrigin: string;
  cognitoDomain: string;
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

export function mcpResourceUrl(config: McpConfig): string {
  return `${config.apiOrigin}/mcp`;
}

export function protectedResourceMetadataUrl(config: McpConfig): string {
  return `${config.apiOrigin}/.well-known/oauth-protected-resource`;
}
