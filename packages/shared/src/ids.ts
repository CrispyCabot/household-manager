import { z } from 'zod';

/**
 * IDs are opaque strings generated with `crypto.randomUUID()`.
 *
 * `#` is excluded deliberately: it is the key-segment separator used
 * throughout `keys.ts`, so an id containing `#` could make one item's key
 * collide with another's.
 */
export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'must contain only letters, digits, hyphen, or underscore');
