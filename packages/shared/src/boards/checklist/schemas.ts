import { z } from 'zod';
import { IdSchema } from '../../ids.js';

export const ChecklistItemSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  boardId: IdSchema,
  text: z.string().min(1).max(500),
  checked: z.boolean(),
  /** Display order among unchecked items — checked items sort after all unchecked ones, by `checkedAt`. */
  position: z.number().int().nonnegative(),
  checkedAt: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const CreateChecklistItemSchema = z.object({
  text: z.string().min(1).max(500),
});
export type CreateChecklistItemInput = z.infer<typeof CreateChecklistItemSchema>;

export const UpdateChecklistItemSchema = z.object({
  text: z.string().min(1).max(500),
});
export type UpdateChecklistItemInput = z.infer<typeof UpdateChecklistItemSchema>;
