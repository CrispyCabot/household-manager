import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.js';

/** Holds a route until the session is known — see Poster Walls Editor's identical component for why. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, signIn } = useAuth();

  if (status === 'loading') {
    return <p className="notice">Restoring your session…</p>;
  }

  if (status === 'signed-out') {
    return (
      <div className="gate">
        <h1>Sign in to continue</h1>
        <button type="button" className="btn-primary" onClick={() => void signIn()}>
          Sign in
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
