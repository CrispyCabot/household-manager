import { z } from 'zod';
import { IdSchema } from '../ids.js';

export const ScheduleModeSchema = z.enum(['on', 'screensaver', 'off']);
export type ScheduleMode = z.infer<typeof ScheduleModeSchema>;

/**
 * 24-hour "HH:mm", read as a wall-clock time in `America/New_York` — same
 * shape as `boards/tasks/schemas.ts`'s `TimeOfDaySchema`, duplicated (and
 * distinctly named, to avoid a barrel-export collision with it) rather than
 * imported, so a device-schedule change can never accidentally ripple into
 * task notification timing or vice versa; the two happen to share a format,
 * not a meaning.
 */
export const DeviceTimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ScheduleRuleSchema = z.object({
  /** 0=Sunday .. 6=Saturday. */
  days: z.array(z.number().int().min(0).max(6)).min(1),
  from: DeviceTimeOfDaySchema,
  to: DeviceTimeOfDaySchema,
  mode: ScheduleModeSchema,
});
export type ScheduleRule = z.infer<typeof ScheduleRuleSchema>;

/** Offered at claim time so a newly paired device is useful immediately. */
export const DEFAULT_SCHEDULE: ScheduleRule[] = [
  { days: [1, 2, 3, 4, 5], from: '06:30', to: '22:00', mode: 'on' },
  { days: [1, 2, 3, 4, 5], from: '22:00', to: '06:30', mode: 'off' },
  { days: [0, 6], from: '07:30', to: '23:00', mode: 'on' },
  { days: [0, 6], from: '23:00', to: '07:30', mode: 'off' },
];

// --- layout (phase 4 edits this; phase 1 only stores `null`) --------------

export const DashboardLayoutItemSchema = z.object({
  boardId: IdSchema,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
export type DashboardLayoutItem = z.infer<typeof DashboardLayoutItemSchema>;

export const DashboardLayoutSchema = z.object({
  columns: z.number().int().positive().default(12),
  items: z.array(DashboardLayoutItemSchema),
});
export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;

// --- device -----------------------------------------------------------

/**
 * `secretHash` is deliberately absent — this is the shape returned to
 * clients, and the hash of a device's credential must never leave the API,
 * even to that device itself.
 */
export const DeviceSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  name: z.string().min(1).max(120),
  kind: z.literal('dashboard'),
  schedule: z.array(ScheduleRuleSchema),
  layout: DashboardLayoutSchema.nullable(),
  lastSeenAt: z.string().nullable(),
  lastSeenAgent: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const ClaimDeviceSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(120),
});
export type ClaimDeviceInput = z.infer<typeof ClaimDeviceSchema>;

export const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  schedule: z.array(ScheduleRuleSchema).optional(),
  layout: DashboardLayoutSchema.nullable().optional(),
});
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;

// --- pairing & device tokens --------------------------------------------

export const PairResponseSchema = z.object({
  code: z.string(),
  /** ISO instant — the pairing code stops being claimable after this. */
  expiresAt: z.string(),
});
export type PairResponse = z.infer<typeof PairResponseSchema>;

export const PairStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('claimed'),
    deviceId: IdSchema,
    householdId: IdSchema,
    /** Sent exactly once — the poll response that carries this deletes the pairing record. */
    deviceSecret: z.string(),
  }),
]);
export type PairStatus = z.infer<typeof PairStatusSchema>;

/**
 * `householdId` rides along even though `deviceId` alone identifies the
 * device — this endpoint is unauthenticated, so there is no session to
 * derive it from, and the device already has it (handed over in the
 * pairing response, see `PairStatusSchema`'s `claimed` branch) to persist
 * alongside its secret. That lets the API look the device up with a direct
 * key read instead of a second, global-scoped lookup index for it.
 */
export const DeviceTokenRequestSchema = z.object({
  deviceId: IdSchema,
  householdId: IdSchema,
  deviceSecret: z.string().min(1),
});
export type DeviceTokenRequest = z.infer<typeof DeviceTokenRequestSchema>;

export const DeviceTokenResponseSchema = z.object({
  token: z.string(),
  /** Seconds until the token itself expires — not the device's own lifetime, which is indefinite until revoked. */
  expiresIn: z.number().int().positive(),
});
export type DeviceTokenResponse = z.infer<typeof DeviceTokenResponseSchema>;
