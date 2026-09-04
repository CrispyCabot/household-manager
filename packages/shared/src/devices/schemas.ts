import { z } from 'zod';
import { IdSchema } from '../ids.js';
import { ThemeSchema } from '../theme/schemas.js';

/**
 * Just awake/asleep — screensaver is not a schedule state (it was, but is
 * now a standalone `Device.screensaverEnabled` toggle instead, switchable
 * any time rather than only within a scheduled window; see that field's own
 * doc comment for why).
 */
export const ScheduleModeSchema = z.enum(['on', 'off']);
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

/** Common to every kind of tile a household can place on a dashboard's custom grid. */
const LayoutItemPlacementSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  /** Enlarges this tile's own content (font size and spacing together, via CSS `transform: scale`) without changing its footprint (`w`/`h`) on the grid — a way to make one tile more readable from across the room at the cost of fitting less on it. `1` is the default, unscaled size. */
  contentScale: z.number().min(1).max(3).default(1),
});

export const BoardLayoutItemSchema = LayoutItemPlacementSchema.extend({
  kind: z.literal('board'),
  boardId: IdSchema,
});
export type BoardLayoutItem = z.infer<typeof BoardLayoutItemSchema>;

/**
 * The due-tasks notification panel (`components/AlertBanner.tsx`), placed
 * on the grid like any board — at most one of these ever makes sense (there
 * is only the one household-wide alert feed to show), but nothing enforces
 * that here; `DashboardLayoutEditor.tsx` just never offers to add a second.
 */
export const AlertsLayoutItemSchema = LayoutItemPlacementSchema.extend({
  kind: z.literal('alerts'),
});
export type AlertsLayoutItem = z.infer<typeof AlertsLayoutItemSchema>;

export const DashboardLayoutItemSchema = z.discriminatedUnion('kind', [BoardLayoutItemSchema, AlertsLayoutItemSchema]);
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
  /**
   * Whether "on" (awake, per the schedule above) shows the screensaver clock
   * instead of the real dashboard content — a standalone toggle rather than
   * a third schedule mode, so it can be flipped any time from Settings
   * without editing the schedule, and takes priority over the dashboard's
   * content whenever the schedule itself says "on" (an "off"/asleep window
   * still shows nothing, regardless of this — see routes/Dashboard.tsx).
   */
  screensaverEnabled: z.boolean(),
  /**
   * The device's own screen size in CSS pixels, self-reported by the
   * dashboard page itself (see `PUT /v1/devices/me/screen`) the first time
   * it loads there and whenever it changes — `null` until it has. Lets the
   * layout editor (`DashboardLayoutEditor.tsx`) shape its editing canvas to
   * the *real* screen's aspect ratio, so a layout arranged to fill it
   * renders close to unscaled on the actual device instead of getting
   * non-uniformly stretched to fit (routes/Dashboard.tsx's
   * `useFitToViewport`) whenever the authored content's proportions don't
   * match an unusual screen shape (e.g. a 21:9 ultrawide).
   */
  screenWidth: z.number().int().positive().nullable(),
  screenHeight: z.number().int().positive().nullable(),
  /**
   * A manual override for the *physical* screen size, distinct from
   * `screenWidth`/`screenHeight` above — those stay an honest report of
   * what the device can actually output (e.g. a Pi whose GPU hard-caps at
   * 1920x1080), while this is what a household enters when the display
   * itself is larger and set to stretch that output to fill its panel
   * (e.g. a monitor's own "Fill"/"21:9" scaling mode). When set,
   * routes/Dashboard.tsx lays the dashboard out *as if* it had this much
   * room, then scales that down to the device's real output — so the
   * monitor's own stretch, applied on top, cancels back out to correct
   * proportions filling the whole physical screen. Only correct if the
   * display really is in a linear stretch-to-fill mode; in any mode that
   * preserves aspect ratio (letterboxing/pillarboxing), this would make
   * things look worse, not better.
   */
  physicalScreenWidth: z.number().int().positive().nullable(),
  physicalScreenHeight: z.number().int().positive().nullable(),
  layout: DashboardLayoutSchema.nullable(),
  theme: ThemeSchema.nullable(),
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
  screensaverEnabled: z.boolean().optional(),
  physicalScreenWidth: z.number().int().positive().nullable().optional(),
  physicalScreenHeight: z.number().int().positive().nullable().optional(),
  layout: DashboardLayoutSchema.nullable().optional(),
  theme: ThemeSchema.nullable().optional(),
});
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;

/** What a device reports about its own screen — deliberately separate from `UpdateDeviceSchema`, which a household member sends about a device, not a device about itself. */
export const ReportDeviceScreenSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ReportDeviceScreenInput = z.infer<typeof ReportDeviceScreenSchema>;

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
