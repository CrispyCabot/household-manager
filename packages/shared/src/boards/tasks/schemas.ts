import { z } from 'zod';
import { IdSchema } from '../../ids.js';

export const RecurrenceUnitSchema = z.enum(['day', 'week', 'month', 'year']);
export type RecurrenceUnit = z.infer<typeof RecurrenceUnitSchema>;

/**
 * 'completion' reschedules from the day the task was finished — the chore
 * example (dog cleaned 8/10 -> next due 11/10). 'schedule' reschedules from
 * the ORIGINAL due date, so a fixed obligation paid late does not drift
 * (spec §6).
 */
export const RecurrenceAnchorSchema = z.enum(['completion', 'schedule']);
export type RecurrenceAnchor = z.infer<typeof RecurrenceAnchorSchema>;

export const RecurrenceSchema = z.object({
  every: z.number().int().positive(),
  unit: RecurrenceUnitSchema,
  anchor: RecurrenceAnchorSchema,
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const NotifyPrefsSchema = z.object({
  inApp: z.boolean().default(true),
  email: z.boolean().default(true),
});
export type NotifyPrefs = z.infer<typeof NotifyPrefsSchema>;

/** 24-hour "HH:mm", read as a wall-clock time in `America/New_York` — see `nagStart`. */
export const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * `'ok'` covers both "synced successfully" and "sync not applicable" (the
 * board or this task has it turned off) — there is no `'disabled'` state
 * because nothing downstream needs to distinguish those two; both mean
 * there is nothing to show the user. `'pending'`/`'error'` are what
 * `reconcilePendingCalendarSyncs` (api/src/google/taskSync.ts) retries.
 */
export const CalendarSyncStateSchema = z.enum(['ok', 'pending', 'error']);
export type CalendarSyncState = z.infer<typeof CalendarSyncStateSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  boardId: IdSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  dueAt: z.string(),
  recurrence: RecurrenceSchema.nullable(),
  leadTimeDays: z.number().int().nonnegative().default(0),
  /** When notifications begin on their start day, Eastern time. `null` means the default, midnight. */
  notifyTimeOfDay: TimeOfDaySchema.nullable(),
  /** How often a still-outstanding task re-nags, in hours. `null` means the recurrence-based default — see `effectiveRenotifyIntervalHours`. */
  renotifyIntervalHours: z.number().int().positive().max(24 * 30).nullable(),
  notify: NotifyPrefsSchema,
  status: z.enum(['active', 'completed']),
  /** Set by snooze; governs external delivery pacing only — see this plan's design note. */
  snoozedUntil: z.string().nullable(),
  dismissed: z.boolean(),
  notifyAfter: z.string().nullable(),
  lastCompletedAt: z.string().nullable(),
  lastCompletedBy: z.string().nullable(),
  /** `null` inherits the board's `TasksBoardConfig.googleSync.enabled` — an explicit `true`/`false` overrides it for this one task. */
  syncToCalendar: z.boolean().nullable(),
  /** Both null until the first successful sync; identify the one Google event mirroring this task's *current* occurrence — see FEATURE_ANALYSIS.md's Phase 3, "Occurrences, not recurring events". */
  googleEventId: z.string().nullable(),
  googleCalendarId: z.string().nullable(),
  syncState: CalendarSyncStateSchema,
  syncError: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().nonnegative(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  dueAt: z.string(),
  recurrence: RecurrenceSchema.nullable().default(null),
  leadTimeDays: z.number().int().nonnegative().default(0),
  notifyTimeOfDay: TimeOfDaySchema.nullable().default(null),
  renotifyIntervalHours: z.number().int().positive().max(24 * 30).nullable().default(null),
  notify: NotifyPrefsSchema.default({ inApp: true, email: true }),
  syncToCalendar: z.boolean().nullable().default(null),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = CreateTaskSchema.extend({
  /** The version the client last read. A mismatch means someone else wrote. */
  version: z.number().int().nonnegative(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const SnoozeTaskSchema = z.object({
  hours: z.number().positive().max(24 * 30).default(24),
});
export type SnoozeTaskInput = z.infer<typeof SnoozeTaskSchema>;

/** A tasks board's `Board.config` — see FEATURE_ANALYSIS.md's Phase 3, "Opt-in". */
export const TasksBoardConfigSchema = z.object({
  googleSync: z
    .object({
      enabled: z.boolean().default(false),
      /** Which of the household's connected Google calendars new events go to — required once `enabled` is true, but not enforced at the schema level since the config UI sets both together. */
      calendarId: z.string().nullable().default(null),
    })
    .default({ enabled: false, calendarId: null }),
});
export type TasksBoardConfig = z.infer<typeof TasksBoardConfigSchema>;
