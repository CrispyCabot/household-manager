import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { isAndroidApp } from './native.js';

const env = import.meta.env;
const webConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

/** Android builds need google-services.json; the website needs the Firebase web app's config at build time. */
export const analyticsBuiltIn = isAndroidApp
  ? env.VITE_ANALYTICS_ENABLED === 'true'
  : Object.values(webConfig).every((v) => typeof v === 'string' && v !== '');

/** Never put names, emails, titles or ids in params; only a few fixed, low-cardinality values. */
export interface AnalyticsEvents {
  board_opened: { board_type: string };
  board_created: { board_type: string };
  task_created: { repeats: 'yes' | 'no' };
  task_completed: { repeats: 'yes' | 'no' };
  checklist_item_added: Record<string, never>;
  checklist_item_checked: Record<string, never>;
}

const OPT_OUT_KEY = 'hhm.analyticsOff';

export function analyticsOptedOut(): boolean {
  return window.localStorage.getItem(OPT_OUT_KEY) === 'true';
}

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  ready ??= isAndroidApp
    ? Promise.resolve()
    : Promise.all([import('firebase/app'), import('firebase/analytics')]).then(([app, analytics]) => {
        analytics.setConsent({
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
          analytics_storage: 'granted',
        });
        analytics.initializeAnalytics(app.initializeApp(webConfig), {
          config: { send_page_view: false, page_location: `${window.location.origin}/` },
        });
      });
  return ready;
}

function report(err: unknown): void {
  console.error('analytics', err);
}

function collect(enabled: boolean): void {
  void init()
    .then(() => FirebaseAnalytics.setEnabled({ enabled }))
    .catch(report);
}

export function startAnalytics(): void {
  if (!analyticsBuiltIn) return;
  if (isAndroidApp || !analyticsOptedOut()) collect(!analyticsOptedOut());
}

export function setAnalyticsOptOut(off: boolean): void {
  if (off) window.localStorage.setItem(OPT_OUT_KEY, 'true');
  else window.localStorage.removeItem(OPT_OUT_KEY);
  if (!analyticsBuiltIn || (off && !isAndroidApp && ready === null)) return;
  collect(!off);
}

function track(send: () => Promise<void>): void {
  if (!analyticsBuiltIn || analyticsOptedOut()) return;
  void init().then(send).catch(report);
}

/** On the web this is a page_view whose path is the screen name, so no household or board ids reach Analytics. */
export function logScreen(screenName: string): void {
  track(() =>
    isAndroidApp
      ? FirebaseAnalytics.setCurrentScreen({ screenName })
      : FirebaseAnalytics.logEvent({
          name: 'page_view',
          params: { page_title: screenName, page_location: `${window.location.origin}/${screenName}` },
        }),
  );
}

export function logEvent<K extends keyof AnalyticsEvents>(name: K, params: AnalyticsEvents[K]): void {
  track(() => FirebaseAnalytics.logEvent({ name, params }));
}
