import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { userManager } from '../auth/oidc.js';

export function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    userManager
      .signinRedirectCallback()
      // `state` round-trips whatever AuthProvider's signIn() passed in —
      // the path the user was on before being sent to sign in — so a
      // deep link (e.g. from a reminder email) survives the login detour
      // instead of always dropping back to the household list.
      .then((user) => navigate(typeof user.state === 'string' ? user.state : '/', { replace: true }))
      .catch(() => navigate('/', { replace: true }));
  }, [navigate]);

  return <p className="notice">Signing you in…</p>;
}
