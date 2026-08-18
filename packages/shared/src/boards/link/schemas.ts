import { z } from 'zod';

/** A curated preset, not a free-form icon field — keeps every household's link board visually consistent and avoids storing arbitrary icon-library identifiers that could go stale across a dependency upgrade. */
export const LinkIconSchema = z.enum([
  'spreadsheet',
  'calendar',
  'website',
  'document',
  'photos',
  'video',
  'shopping',
  'email',
  'map',
  'cloud',
  'music',
  'note',
]);
export type LinkIcon = z.infer<typeof LinkIconSchema>;

export const LinkDocSchema = z.object({
  /** Null until the member who created the board sets it. */
  url: z.string().nullable(),
  icon: LinkIconSchema,
});
export type LinkDoc = z.infer<typeof LinkDocSchema>;

export const UpdateLinkDocSchema = z.object({
  url: z.string().min(1).max(2000),
  icon: LinkIconSchema,
});
export type UpdateLinkDocInput = z.infer<typeof UpdateLinkDocSchema>;

export function emptyLinkDoc(): LinkDoc {
  return { url: null, icon: 'website' };
}
