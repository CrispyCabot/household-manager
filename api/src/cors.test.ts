import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANDROID_APP_ORIGIN, createApp } from './app.js';

const WEB_ORIGIN = 'https://household-manager.example';

describe('CORS', () => {
  afterEach(() => vi.unstubAllEnvs());

  async function allowedOrigin(origin: string): Promise<string | null> {
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    const res = await createApp().request('/health', { headers: { Origin: origin } });
    return res.headers.get('Access-Control-Allow-Origin');
  }

  it('allows the web app', async () => {
    expect(await allowedOrigin(WEB_ORIGIN)).toBe(WEB_ORIGIN);
  });

  it('allows the Android app', async () => {
    expect(await allowedOrigin(ANDROID_APP_ORIGIN)).toBe(ANDROID_APP_ORIGIN);
  });

  it('answers any other origin with the web origin', async () => {
    expect(await allowedOrigin('https://elsewhere.example')).toBe(WEB_ORIGIN);
  });
});
