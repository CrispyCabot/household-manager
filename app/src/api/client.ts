import { getConfig } from '../config.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * A browser's own default timeout for a hung `fetch()` (no response, no
 * explicit network error — the state a flaky WiFi connection tends to leave
 * a request in) is unbounded in practice, sometimes minutes. That's
 * tolerable for a person who can just retry; it's not for an unattended
 * wall dashboard, where `DeviceAuthProvider`'s token-renewal retry loop
 * only ever gets a chance to run again *after* the current attempt settles
 * — one hung request there stalls every device-authenticated fetch behind
 * it indefinitely, which is what "the dashboard stopped updating and never
 * came back on its own" looks like from the outside. Aborting after a fixed
 * timeout turns that hang into an ordinary failure the existing retry logic
 * already knows how to recover from.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(path: string, bearerToken: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${getConfig().apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${bearerToken}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let code = 'request_failed';
    let message = `Request failed with ${res.status}`;
    try {
      const body = (await res.json()) as ErrorBody;
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // keep the defaults
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
