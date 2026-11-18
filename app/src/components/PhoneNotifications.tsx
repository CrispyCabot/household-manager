import { notifiesByApp } from '@hhm/shared';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMe } from '../api/queries.js';
import { useAuth } from '../auth/AuthProvider.js';
import { onNotificationTap, phoneNotificationsBuiltIn, registerPhone } from '../push.js';

/** In the Android app, keeps this phone signed up for reminders while the person wants them here. */
export function PhoneNotifications() {
  const navigate = useNavigate();
  const { bearerToken } = useAuth();
  const { data: me } = useMe();
  const registeredFor = useRef<string | null>(null);
  const wantsPhone = me !== undefined && notifiesByApp(me.notifyVia);

  useEffect(() => (phoneNotificationsBuiltIn ? onNotificationTap((path) => void navigate(path)) : undefined), [navigate]);

  useEffect(() => {
    if (!phoneNotificationsBuiltIn || !wantsPhone || bearerToken === null || me === undefined) return;
    if (registeredFor.current === me.sub) return;
    registeredFor.current = me.sub;
    registerPhone(bearerToken, me.sub).catch((err: unknown) => {
      registeredFor.current = null;
      console.error('could not sign this phone up for reminders', err);
    });
  }, [wantsPhone, bearerToken, me]);

  return null;
}
