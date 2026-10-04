import type { User } from 'oidc-client-ts';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { signOut as cognitoSignOut, userManager } from './oidc.js';

type Status = 'loading' | 'signed-in' | 'signed-out';

interface AuthValue {
  user: User | null;
  /** The ID token, sent as the API's bearer token — see api/src/auth.ts. */
  bearerToken: string | null;
  status: Status;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;

    function applyUser(found: User | null) {
      if (cancelled) return;
      const signedIn = found !== null && !found.expired;
      setUser(signedIn ? found : null);
      setStatus(signedIn ? 'signed-in' : 'signed-out');
    }

    function onUserLoaded(loadedUser: User) {
      applyUser(loadedUser);
    }
    function onUserUnloaded() {
      applyUser(null);
    }
    function onSilentRenewError(err: Error) {
      console.error('silent token renewal failed', err);
      // A renewal can fail transiently (offline, flaky network) while the
      // current token is still good — only drop to signed-out once it has
      // actually expired, which applyUser checks.
      userManager.getUser().then(applyUser, () => applyUser(null));
    }

    /**
     * Exchanges the stored refresh token for fresh tokens. Needed on startup
     * and on returning to the tab: the automatic renewal timer doesn't run
     * while the browser is closed or the machine asleep, so a token that
     * expired in the meantime must be renewed here rather than treated as a
     * sign-out — the refresh token behind it is valid for far longer.
     */
    async function renewIfNeeded(found: User | null): Promise<User | null> {
      if (found === null) return null;
      const expiresSoon = found.expired || (found.expires_in !== undefined && found.expires_in < 120);
      if (!expiresSoon || !found.refresh_token) return found;
      try {
        return await userManager.signinSilent();
      } catch (err) {
        console.error('token renewal failed', err);
        return found;
      }
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      void userManager.getUser().then(renewIfNeeded).then((u) => applyUser(u ?? null));
    }
    document.addEventListener('visibilitychange', onVisible);

    userManager.events.addUserLoaded(onUserLoaded);
    userManager.events.addUserUnloaded(onUserUnloaded);
    userManager.events.addSilentRenewError(onSilentRenewError);

    userManager
      .getUser()
      .then(renewIfNeeded)
      .then(applyUser)
      .catch(() => {
        if (!cancelled) setStatus('signed-out');
      });

    return () => {
      cancelled = true;
      userManager.events.removeUserLoaded(onUserLoaded);
      userManager.events.removeUserUnloaded(onUserUnloaded);
      userManager.events.removeSilentRenewError(onSilentRenewError);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      bearerToken: user?.id_token ?? null,
      status,
      // Carries the current path through Cognito's Hosted UI as OIDC `state`
      // so Callback.tsx can return the user to the page they signed in from
      // (e.g. a task board deep-linked from a reminder email) instead of
      // always landing on the household list.
      signIn: () => userManager.signinRedirect({ state: window.location.pathname + window.location.search }),
      signOut: () => cognitoSignOut(),
    }),
    [user, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
