import { isPushTokenRegistered } from './db/pushTokens.js';

/**
 * What a reminder's Mark complete / Dismiss button sends when it acts without
 * opening the app: the member's `sub` and the Firebase token that received
 * the reminder. It's only valid while that token is still registered to that
 * member, so signing out (which unregisters the phone) revokes it.
 */
export const PHONE_CREDENTIAL_PREFIX = 'phone_';

export function isPhoneCredential(token: string): boolean {
  return token.startsWith(PHONE_CREDENTIAL_PREFIX);
}

export async function verifyPhoneCredential(
  credential: string,
  isRegistered: typeof isPushTokenRegistered = isPushTokenRegistered,
): Promise<{ sub: string }> {
  const parsed: unknown = JSON.parse(Buffer.from(credential.slice(PHONE_CREDENTIAL_PREFIX.length), 'base64url').toString('utf8'));
  const { sub, token } = (parsed ?? {}) as { sub?: unknown; token?: unknown };
  if (typeof sub !== 'string' || typeof token !== 'string' || sub === '' || token === '') {
    throw new Error('malformed phone credential');
  }
  if (!(await isRegistered(sub, token))) throw new Error('phone is not registered');
  return { sub };
}
