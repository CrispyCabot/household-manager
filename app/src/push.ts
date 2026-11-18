import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiFetch } from './api/client.js';
import { getConfig } from './config.js';
import { isAndroidApp } from './native.js';

/** Off in Android builds made without google-services.json, where registering would crash the app. */
export const phoneNotificationsBuiltIn = isAndroidApp && import.meta.env.VITE_PUSH_ENABLED === 'true';

const TOKEN_KEY = 'hhm.pushToken';

/** The app's own native side (ReminderActionsPlugin.java), which needs these to act on a reminder's buttons without opening the app. */
const ReminderActions = registerPlugin<{
  remember(options: { apiUrl: string; sub: string }): Promise<void>;
  forget(): Promise<void>;
}>('ReminderActions');

function storedToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

/** Asks Android for permission (once), then tells the API where to send this person's reminders. */
export async function registerPhone(bearerToken: string, sub: string): Promise<'registered' | 'denied'> {
  let { receive } = await PushNotifications.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== 'granted') return 'denied';

  const listeners: Promise<PluginListenerHandle>[] = [];
  const token = await new Promise<string>((resolve, reject) => {
    listeners.push(PushNotifications.addListener('registration', ({ value }) => resolve(value)));
    listeners.push(PushNotifications.addListener('registrationError', ({ error }) => reject(new Error(error))));
    void PushNotifications.register();
  }).finally(() => listeners.forEach((l) => void l.then((h) => h.remove())));

  const previous = storedToken();
  if (previous !== null && previous !== token) await unregisterPhone(bearerToken);
  await ReminderActions.remember({ apiUrl: getConfig().apiUrl, sub });
  await apiFetch<void>('/v1/me/push-token', bearerToken, { method: 'PUT', body: JSON.stringify({ token, actionButtons: true }) });
  window.localStorage.setItem(TOKEN_KEY, token);
  return 'registered';
}

export async function unregisterPhone(bearerToken: string): Promise<void> {
  const token = storedToken();
  if (!phoneNotificationsBuiltIn || token === null) return;
  await apiFetch<void>('/v1/me/push-token', bearerToken, { method: 'DELETE', body: JSON.stringify({ token }) });
  window.localStorage.removeItem(TOKEN_KEY);
  await ReminderActions.forget();
}

/** Opens the board a reminder is about when it's tapped. */
export function onNotificationTap(goTo: (path: string) => void): () => void {
  const listener = PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const path = (notification.data as { path?: unknown } | undefined)?.path;
    if (typeof path === 'string' && path.startsWith('/')) goTo(path);
  });
  return () => void listener.then((l) => l.remove());
}
