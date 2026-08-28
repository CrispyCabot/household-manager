export function googleClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId === undefined || clientId === '' || clientSecret === undefined || clientSecret === '') {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
  }
  return { clientId, clientSecret };
}

/**
 * Must exactly match a redirect URI configured on the Google Cloud Console
 * OAuth client (FEATURE_ANALYSIS.md's Phase 2 console-setup steps) — Google
 * rejects the exchange otherwise. `API_ORIGIN` is the API's own base URL
 * (e.g. `https://api.household-manager.chrisbridewell.dev`), set by
 * `infrastructure/lib/main-stack.ts` alongside the existing `WEB_ORIGIN`.
 */
export function googleRedirectUri(): string {
  const apiOrigin = process.env.API_ORIGIN;
  if (apiOrigin === undefined || apiOrigin === '') throw new Error('API_ORIGIN is not set');
  return `${apiOrigin}/v1/google/callback`;
}
