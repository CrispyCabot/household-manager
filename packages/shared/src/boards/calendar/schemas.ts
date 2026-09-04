import { z } from 'zod';

/**
 * One calendar the board has been told to show — `id` is Google's own
 * calendar id (an opaque string, often an email-shaped one for a person's
 * primary calendar), not one of ours.
 */
export const CalendarSelectionSchema = z.object({
  id: z.string().min(1),
  /** A short display label — Google's own `summary`, captured at selection time so the picker doesn't need a live lookup to render existing selections. */
  label: z.string().min(1).max(200),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  enabled: z.boolean().default(true),
});
export type CalendarSelection = z.infer<typeof CalendarSelectionSchema>;

export const CalendarViewSchema = z.enum(['agenda', 'week', 'month']);
export type CalendarView = z.infer<typeof CalendarViewSchema>;

/** A calendar board's `Board.config` — validated by the generic `PATCH .../boards/:bid/config` route against this, via `registerBoardType`'s `configSchema`. */
export const CalendarBoardConfigSchema = z.object({
  calendars: z.array(CalendarSelectionSchema).default([]),
  defaultView: CalendarViewSchema.default('agenda'),
  /** How far ahead the board's Card preview looks — the full Page always offers all three views regardless. */
  daysAhead: z.number().int().positive().max(90).default(7),
});
export type CalendarBoardConfig = z.infer<typeof CalendarBoardConfigSchema>;

/**
 * One event, already normalised out of Google's payload shape — nothing
 * Google-specific (their nested `start.dateTime`/`start.date` distinction,
 * their `id` namespacing, etc.) reaches the client. See
 * `api/src/google/calendar.ts`'s `normalizeEvent`.
 */
export const CalendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string(),
  /** ISO instant for a timed event; `YYYY-MM-DD` for an all-day one — `allDay` is what disambiguates. */
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  description: z.string().nullable(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
