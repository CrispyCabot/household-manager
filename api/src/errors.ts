import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (c: Context) =>
  c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);

export function errorHandler(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof ZodError) {
    console.error('validation error', err.issues);
    return c.json({ error: { code: 'validation_error', message: 'Invalid request' } }, 400);
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error('unhandled error', err);
  return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
}
