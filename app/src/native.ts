import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { INavigator } from 'oidc-client-ts';

export const isAndroidApp = Capacitor.isNativePlatform();

const APP_SCHEME = 'com.chrisbridewell.householdmanager';
export const ANDROID_SIGN_IN_REDIRECT = `${APP_SCHEME}://callback`;
export const ANDROID_SIGN_OUT_REDIRECT = `${APP_SCHEME}://signout`;

/** In the Android app this opens a Chrome tab, since Google refuses to sign in inside a WebView. */
export function openExternalPage(url: string): void {
  if (isAndroidApp) void Browser.open({ url });
  else window.location.assign(url);
}

export const browserTabNavigator: INavigator = {
  prepare: async () => ({
    navigate: async ({ url }) => {
      await Browser.open({ url });
      return { url };
    },
    close: () => undefined,
  }),
  callback: async () => undefined,
};

/** Hands the in-app path for each redirect back into the app (e.g. Cognito's sign-in callback). */
export function onAppRedirect(goTo: (path: string) => void): () => void {
  function handle(url: string) {
    if (!url.startsWith(`${APP_SCHEME}://`)) return;
    void Browser.close().catch(() => undefined);
    const { host, search } = new URL(url);
    if (host === 'callback') goTo(`/callback${search}`);
  }
  void App.getLaunchUrl().then((launch) => launch && handle(launch.url));
  const listener = App.addListener('appUrlOpen', ({ url }) => handle(url));
  return () => void listener.then((l) => l.remove());
}
