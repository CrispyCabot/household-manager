import { z } from 'zod';

/**
 * A text-entry board's document is stored as structured blocks/runs, never
 * raw HTML. This is a deliberate security choice, not a missing feature: the
 * web client renders every run's `text` as a plain React child (auto-escaped)
 * rather than through `dangerouslySetInnerHTML`, so a household member who
 * calls the API directly with a crafted payload cannot inject markup that
 * runs in another member's browser. There is nothing to sanitize because
 * there is no HTML on the wire in the first place.
 */
export const TextBlockTypeSchema = z.enum(['paragraph', 'h1', 'h2', 'h3', 'bullet', 'number']);
export type TextBlockType = z.infer<typeof TextBlockTypeSchema>;

export const TextRunSchema = z.object({
  text: z.string().max(4000),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  strike: z.boolean().default(false),
});
export type TextRun = z.infer<typeof TextRunSchema>;

export const TextBlockSchema = z.object({
  type: TextBlockTypeSchema,
  runs: z.array(TextRunSchema).max(300),
});
export type TextBlock = z.infer<typeof TextBlockSchema>;

export const TextDocSchema = z.object({
  blocks: z.array(TextBlockSchema).max(1000),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type TextDoc = z.infer<typeof TextDocSchema>;

export const UpdateTextDocSchema = z.object({
  blocks: z.array(TextBlockSchema).max(1000),
});
export type UpdateTextDocInput = z.infer<typeof UpdateTextDocSchema>;

export function emptyTextDoc(): TextDoc {
  return { blocks: [{ type: 'paragraph', runs: [] }], updatedBy: null, updatedAt: null };
}
