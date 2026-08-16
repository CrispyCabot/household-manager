import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { userManager } from '../auth/oidc.js';

export function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    userManager
      .signinRedirectCallback()
      .then(() => navigate('/', { replace: true }))
      .catch(() => navigate('/', { replace: true }));
  }, [navigate]);

  return <p className="notice">Signing you in…</p>;
}
