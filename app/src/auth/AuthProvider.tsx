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
      applyUser(null);
    }

    userManager.events.addUserLoaded(onUserLoaded);
    userManager.events.addUserUnloaded(onUserUnloaded);
    userManager.events.addSilentRenewError(onSilentRenewError);

    userManager
      .getUser()
      .then(applyUser)
      .catch(() => {
        if (!cancelled) setStatus('signed-out');
      });

    return () => {
      cancelled = true;
      userManager.events.removeUserLoaded(onUserLoaded);
      userManager.events.removeUserUnloaded(onUserUnloaded);
      userManager.events.removeSilentRenewError(onSilentRenewError);
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      bearerToken: user?.id_token ?? null,
      status,
      signIn: () => userManager.signinRedirect(),
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
