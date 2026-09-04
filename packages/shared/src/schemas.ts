import { z } from 'zod';
import { IdSchema } from './ids.js';
import { ThemeSchema } from './theme/schemas.js';

export const EmailSchema = z
  .string()
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());

// --- households --------------------------------------------------------

export const HouseholdSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().nonnegative(),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateHousehold = z.infer<typeof CreateHouseholdSchema>;

export const UpdateHouseholdSchema = z.object({
  name: z.string().min(1).max(120),
  /** The version the client last read. A mismatch means someone else wrote. */
  version: z.number().int().nonnegative(),
});
export type UpdateHousehold = z.infer<typeof UpdateHouseholdSchema>;

export const HouseholdSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
});
export type HouseholdSummary = z.infer<typeof HouseholdSummarySchema>;

// --- members & invites ---------------------------------------------------

export const MemberSchema = z.object({
  sub: z.string(),
  email: z.string(),
  joinedAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

export const InviteSchema = z.object({
  householdId: IdSchema,
  email: z.string(),
  invitedAt: z.string(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const CreateInviteSchema = z.object({
  email: EmailSchema,
});
export type CreateInviteInput = z.input<typeof CreateInviteSchema>;

// --- profile ---------------------------------------------------------------

export const ProfileSchema = z.object({
  sub: z.string(),
  email: z.string(),
  lastHouseholdId: IdSchema.nullable(),
  /** The signed-in user's own app-wide theme — applies everywhere except a wall dashboard, which uses its device's own theme instead. */
  theme: ThemeSchema.nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const MeResponseSchema = z.object({
  sub: z.string(),
  email: z.string(),
  lastHouseholdId: IdSchema.nullable(),
  theme: ThemeSchema.nullable(),
  households: z.array(HouseholdSummarySchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// --- boards ------------------------------------------------------------

export const BoardSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  type: z.string(),
  title: z.string().min(1).max(120),
  position: z.number().int().nonnegative(),
  /**
   * Per-board settings, validated against that board type's own
   * `configSchema` (`boards.ts`'s `BoardTypeDefinition`) — declared there
   * since day one, unused until the calendar board type
   * (FEATURE_ANALYSIS.md's Phase 2) became the first type that actually
   * needs one. `unknown` here, not a per-type union: the core board layer
   * doesn't know what any type's config looks like, by design (spec §5) —
   * only `PATCH .../boards/:bid/config`'s handler validates it, against
   * whichever type the board actually is.
   */
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Board = z.infer<typeof BoardSchema>;

export const CreateBoardSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1).max(120),
});
export type CreateBoard = z.infer<typeof CreateBoardSchema>;

export const UpdateBoardSchema = z.object({
  title: z.string().min(1).max(120),
});
export type UpdateBoard = z.infer<typeof UpdateBoardSchema>;

/** Validated against the board's own type's `configSchema` at the route level — see `BoardSchema.config`'s doc comment. */
export const UpdateBoardConfigSchema = z.record(z.string(), z.unknown());
export type UpdateBoardConfig = z.infer<typeof UpdateBoardConfigSchema>;

export const ReorderBoardsSchema = z.object({
  boardIds: z.array(IdSchema).min(1),
});
export type ReorderBoards = z.infer<typeof ReorderBoardsSchema>;
