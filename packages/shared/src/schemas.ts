import { z } from 'zod';
import { IdSchema } from './ids.js';

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
});
export type Profile = z.infer<typeof ProfileSchema>;

export const MeResponseSchema = z.object({
  sub: z.string(),
  email: z.string(),
  lastHouseholdId: IdSchema.nullable(),
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
