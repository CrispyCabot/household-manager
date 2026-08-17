/**
 * DynamoDB key addressing for the single table (spec §4).
 *
 * Layout:
 *   HH#<householdId>       META
 *   HH#<householdId>       BOARD#<boardId>
 *   HH#<householdId>       BOARD#<boardId>#TASK#<taskId>          (phase 2)
 *   HH#<householdId>       MEMBER#<sub>
 *   HH#<householdId>       INVITE#<email>
 *   USER#<sub>              PROFILE
 *   USER#<sub>              HH#<householdId>                       (membership / switcher index)
 *   INVITE#<email>          HH#<householdId>                       (invite, by invitee)
 *
 * GSI1 (sparse): every active, non-dismissed task carries GSI1PK/GSI1SK,
 * keyed by its future nag-start moment — not only tasks currently due.
 * Declared here so phase 2 does not have to touch the table construct again.
 */

export const META = 'META';
export const PROFILE = 'PROFILE';

export const BOARD_SK_PREFIX = 'BOARD#';
export const MEMBER_SK_PREFIX = 'MEMBER#';
export const INVITE_SK_PREFIX = 'INVITE#';

export function householdPk(householdId: string): string {
  return `HH#${householdId}`;
}

export function userPk(sub: string): string {
  return `USER#${sub}`;
}

export function invitePk(email: string): string {
  return `INVITE#${normalizeEmail(email)}`;
}

export function boardSk(boardId: string): string {
  return `${BOARD_SK_PREFIX}${boardId}`;
}

export function memberSk(sub: string): string {
  return `${MEMBER_SK_PREFIX}${sub}`;
}

export function householdInviteSk(email: string): string {
  return `${INVITE_SK_PREFIX}${normalizeEmail(email)}`;
}

/** Lowercased and trimmed — the one normalized form every invite/member/profile email is stored and compared as. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The sparse reminder queue (spec §4, §6). Phase 2 writes to it; the table declares it now. */
export const GSI1 = 'GSI1';
export const DUE_PARTITION = 'DUE';
