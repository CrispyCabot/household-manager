export interface AppConfig {
  apiUrl: string;
  cognitoDomain: string;
  userPoolClientId: string;
  redirectUri: string;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      `Missing ${name}. It is injected at build time from CloudFormation outputs; for local dev copy app/.env.example to app/.env.local and fill it in.`,
    );
  }
  return value;
}

export function loadConfig(origin: string): AppConfig {
  const env = import.meta.env;
  return {
    apiUrl: required('VITE_API_URL', env.VITE_API_URL).replace(/\/$/, ''),
    cognitoDomain: required('VITE_COGNITO_DOMAIN', env.VITE_COGNITO_DOMAIN).replace(/\/$/, ''),
    userPoolClientId: required('VITE_USER_POOL_CLIENT_ID', env.VITE_USER_POOL_CLIENT_ID),
    redirectUri: `${origin}/callback`,
  };
}

let cached: AppConfig | null = null;

/** Resolved lazily — a module-level call would run under vitest's node environment, where `window` does not exist. */
export function getConfig(): AppConfig {
  cached ??= loadConfig(window.location.origin);
  return cached;
}
