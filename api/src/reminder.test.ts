import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Household, Member } from '@hhm/shared';

const sendMock = vi.fn(async () => ({}));

vi.mock('@aws-sdk/client-sesv2', () => {
  class SESv2Client {
    send = sendMock;
  }
  class SendEmailCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return { SESv2Client, SendEmailCommand };
});

vi.mock('./actionToken.js', () => ({
  signActionToken: vi.fn(async () => 'signed-token'),
}));

const listMembersMock = vi.fn<() => Promise<Member[]>>();
const loadHouseholdMock = vi.fn<() => Promise<Household | null>>();

vi.mock('./db/households.js', () => ({
  listMembers: (...args: unknown[]) => listMembersMock(...(args as [])),
  loadHousehold: (...args: unknown[]) => loadHouseholdMock(...(args as [])),
}));

const queryAllPagesMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
const snoozeTaskMock = vi.fn(async () => ({}));

vi.mock('./db/tasks.js', () => ({
  queryAllPages: (...args: unknown[]) => queryAllPagesMock(...(args as [])),
  listAlertsForHousehold: vi.fn(async () => []),
  snoozeTask: (...args: unknown[]) => snoozeTaskMock(...(args as [])),
}));

vi.mock('./google/taskSync.js', () => ({
  reconcilePendingCalendarSyncs: vi.fn(async () => {}),
}));

process.env.API_BASE_URL = 'https://api.example.com';
process.env.WEB_DOMAIN = 'example.com';
process.env.TABLE_NAME = 'test-table';

const HID = 'hh-1';
const BID = 'brd-1';
const memberA: Member = { sub: 'user-a', email: 'a@example.com', joinedAt: '2026-01-01T00:00:00.000Z' };
const memberB: Member = { sub: 'user-b', email: 'b@example.com', joinedAt: '2026-01-01T00:00:00.000Z' };
const memberC: Member = { sub: 'user-c', email: 'c@example.com', joinedAt: '2026-01-01T00:00:00.000Z' };

function rawTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tsk-default',
    householdId: HID,
    boardId: BID,
    title: 'Unassigned task',
    description: '',
    dueAt: '2026-01-01T00:00:00.000Z',
    recurrence: null,
    leadTimeDays: 0,
    notifyTimeOfDay: null,
    renotifyIntervalHours: 24,
    notify: { inApp: true, email: true },
    assigneeId: null,
    status: 'active',
    snoozedUntil: null,
    dismissed: false,
    notifyAfter: '2026-01-01T00:00:00.000Z',
    lastCompletedAt: null,
    lastCompletedBy: null,
    syncToCalendar: false,
    calendarId: null,
    colorId: null,
    googleEventId: null,
    googleCalendarId: null,
    syncState: 'ok',
    syncError: null,
    createdBy: memberA.sub,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadHouseholdMock.mockResolvedValue({
    id: HID,
    name: 'Test House',
    createdBy: memberA.sub,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  });
});

// Each entry in `sendMock.mock.calls` is the *argument list* of one call
// (i.e. `[command]`), not the command itself — these unwrap that.
function toAddress(call: unknown[]): string {
  return (call[0] as { input: { Destination: { ToAddresses: string[] } } }).input.Destination.ToAddresses[0]!;
}

function textBody(call: unknown[]): string {
  return (call[0] as { input: { Content: { Simple: { Body: { Text: { Data: string } } } } } }).input.Content.Simple
    .Body.Text.Data;
}

describe('reminder digest targeting by assignee', () => {
  it('sends an unassigned task to every member of the household', async () => {
    listMembersMock.mockResolvedValue([memberA, memberB]);
    queryAllPagesMock.mockResolvedValue([rawTask({ id: 'tsk-unassigned', title: 'Take out trash', assigneeId: null })]);

    const { handler } = await import('./reminder.js');
    const result = await handler();

    expect(result.tasksNotified).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
    const recipients = sendMock.mock.calls.map(toAddress).sort();
    expect(recipients).toEqual([memberA.email, memberB.email].sort());
  });

  it('sends an assigned task only to that member, not the rest of the household', async () => {
    listMembersMock.mockResolvedValue([memberA, memberB]);
    queryAllPagesMock.mockResolvedValue([
      rawTask({ id: 'tsk-assigned', title: 'Pay the mortgage', assigneeId: memberB.sub }),
    ]);

    const { handler } = await import('./reminder.js');
    await handler();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(toAddress(sendMock.mock.calls[0]!)).toBe(memberB.email);
  });

  it('a member with nothing unassigned and nothing assigned to them gets no digest at all', async () => {
    listMembersMock.mockResolvedValue([memberA, memberB, memberC]);
    queryAllPagesMock.mockResolvedValue([
      rawTask({ id: 'tsk-assigned', title: 'Pay the mortgage', assigneeId: memberB.sub }),
    ]);

    const { handler } = await import('./reminder.js');
    await handler();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const recipients = sendMock.mock.calls.map(toAddress);
    expect(recipients).not.toContain(memberA.email);
    expect(recipients).not.toContain(memberC.email);
    expect(recipients).toContain(memberB.email);
  });

  it('combines an assigned task and an unassigned task correctly per member', async () => {
    listMembersMock.mockResolvedValue([memberA, memberB]);
    queryAllPagesMock.mockResolvedValue([
      rawTask({ id: 'tsk-unassigned', title: 'Take out trash', assigneeId: null }),
      rawTask({ id: 'tsk-assigned', title: 'Pay the mortgage', assigneeId: memberB.sub }),
    ]);

    const { handler } = await import('./reminder.js');
    await handler();

    expect(sendMock).toHaveBeenCalledTimes(2);
    const forA = sendMock.mock.calls.find((c) => toAddress(c) === memberA.email);
    const forB = sendMock.mock.calls.find((c) => toAddress(c) === memberB.email);
    expect(forA).toBeDefined();
    expect(forB).toBeDefined();
    expect(textBody(forA!)).toContain('Take out trash');
    expect(textBody(forA!)).not.toContain('Pay the mortgage');
    expect(textBody(forB!)).toContain('Take out trash');
    expect(textBody(forB!)).toContain('Pay the mortgage');
  });

  it('still snoozes every due task forward, whether or not it was assigned', async () => {
    listMembersMock.mockResolvedValue([memberA, memberB]);
    queryAllPagesMock.mockResolvedValue([
      rawTask({ id: 'tsk-unassigned', title: 'Take out trash', assigneeId: null }),
      rawTask({ id: 'tsk-assigned', title: 'Pay the mortgage', assigneeId: memberB.sub }),
    ]);

    const { handler } = await import('./reminder.js');
    await handler();

    const snoozedIds = snoozeTaskMock.mock.calls.map((c) => (c as unknown[])[2]);
    expect(snoozedIds).toEqual(expect.arrayContaining(['tsk-unassigned', 'tsk-assigned']));
  });
});
