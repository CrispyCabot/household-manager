import { z } from 'zod';

export const GoogleConnectionStatusSchema = z.enum(['connected', 'needs_reauth']);
export type GoogleConnectionStatus = z.infer<typeof GoogleConnectionStatusSchema>;

/**
 * What the API returns about a household's Google connection — never the
 * refresh token itself (that lives in Secrets Manager, referenced by an ARN
 * that also never leaves the API; see `api/src/db/google.ts`). One
 * connection per household (FEATURE_ANALYSIS.md's Phase 2 — "One
 * household-level connection"), visible to and shared by every member, and
 * by the wall display too, which is the reason it's a household-level
 * connection rather than a per-user one at all.
 */
export const GoogleConnectionSchema = z.object({
  googleAccountEmail: z.string(),
  scopes: z.array(z.string()),
  status: GoogleConnectionStatusSchema,
  connectedBy: z.string(),
  connectedAt: z.string(),
  lastRefreshedAt: z.string().nullable(),
});
export type GoogleConnection = z.infer<typeof GoogleConnectionSchema>;

/** A calendar Google reports back is available (`calendarList.list`), for the picker in a calendar board's config UI. */
export const GoogleCalendarSchema = z.object({
  id: z.string(),
  summary: z.string(),
  /** Google's own suggested colour for this calendar, if it has one — a sane starting point for `CalendarSelection.colour`, not binding. */
  backgroundColor: z.string().nullable(),
  primary: z.boolean().default(false),
});
export type GoogleCalendar = z.infer<typeof GoogleCalendarSchema>;
