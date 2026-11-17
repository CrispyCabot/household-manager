import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { isAndroidApp, onAppRedirect } from '../native.js';

export function AppRedirects() {
  const navigate = useNavigate();
  useEffect(() => (isAndroidApp ? onAppRedirect((path) => navigate(path, { replace: true })) : undefined), [navigate]);
  return null;
}
