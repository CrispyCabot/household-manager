import { z } from 'zod';

/**
 * Google Calendar's fixed palette of named event colors — the `colorId`
 * values (1-11) accepted by the Calendar API's Events resource, with the
 * same names and swatches Google Calendar's own event color picker shows.
 * This is a stable, documented constant of the API (not per-account data),
 * so it's hardcoded here rather than fetched live on every task-form open.
 */
export const GOOGLE_EVENT_COLORS = [
  { id: '1', name: 'Lavender', hex: '#7986cb' },
  { id: '2', name: 'Sage', hex: '#33b679' },
  { id: '3', name: 'Grape', hex: '#8e24aa' },
  { id: '4', name: 'Flamingo', hex: '#e67c73' },
  { id: '5', name: 'Banana', hex: '#f6c026' },
  { id: '6', name: 'Tangerine', hex: '#f5511d' },
  { id: '7', name: 'Peacock', hex: '#039be5' },
  { id: '8', name: 'Graphite', hex: '#616161' },
  { id: '9', name: 'Blueberry', hex: '#3f51b5' },
  { id: '10', name: 'Basil', hex: '#0b8043' },
  { id: '11', name: 'Tomato', hex: '#d60000' },
] as const;

export const GoogleEventColorIdSchema = z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
export type GoogleEventColorId = z.infer<typeof GoogleEventColorIdSchema>;
