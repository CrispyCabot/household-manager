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

export async function apiFetch<T>(path: string, bearerToken: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${bearerToken}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  });

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
