import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Household, Member, NotificationChannel } from '@hhm/shared';
import type { PushTarget } from './db/pushTokens.js';
import type { PushMessage, PushResult } from './push/fcm.js';

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

const notifyViaMock = vi.fn<(sub: string) => Promise<NotificationChannel>>(async () => 'email');
const textPhoneMock = vi.fn<(sub: string) => Promise<string | null>>(async () => null);
vi.mock('./db/profiles.js', () => ({
  getNotifyVia: (sub: string) => notifyViaMock(sub),
  getClock: async () => '12h',
  getTextPhone: (sub: string) => textPhoneMock(sub),
}));

const sendTextMock = vi.fn<(to: string, body: string) => Promise<void>>(async () => {});
vi.mock('./sms.js', () => ({
  sendText: (to: string, body: string) => sendTextMock(to, body),
}));

const phone = (token: string): PushTarget => ({ token, actionButtons: false });
const listPushTokensMock = vi.fn<(sub: string) => Promise<PushTarget[]>>(async () => []);
const removePushTokenMock = vi.fn(async () => {});
vi.mock('./db/pushTokens.js', () => ({
  listPushTokens: (sub: string) => listPushTokensMock(sub),
  removePushToken: (...args: unknown[]) => removePushTokenMock(...(args as [])),
}));

const sendPushMock = vi.fn<(target: PushTarget, message: PushMessage) => Promise<PushResult>>(async () => 'sent');
vi.mock('./push/fcm.js', () => ({
  sendPush: (target: PushTarget, message: PushMessage) => sendPushMock(target, message),
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
  notifyViaMock.mockResolvedValue('email');
  textPhoneMock.mockResolvedValue(null);
  sendTextMock.mockResolvedValue(undefined);
  listPushTokensMock.mockResolvedValue([]);
  sendPushMock.mockResolvedValue('sent');
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

describe('reminder channel per member', () => {
  const task = rawTask({ id: 'tsk-1', title: 'Take out trash' });

  it('sends only a phone notification to someone who picked the app', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task]);
    notifyViaMock.mockResolvedValue('app');
    listPushTokensMock.mockResolvedValue([phone('phone-1')]);

    const { handler } = await import('./reminder.js');
    const result = await handler();

    expect(sendMock).not.toHaveBeenCalled();
    expect(sendPushMock).toHaveBeenCalledWith(phone('phone-1'), {
      title: 'Take out trash',
      body: 'Test House · due Jan 1',
      path: `/households/${HID}/boards/${BID}/tasks/tsk-1`,
      task: { householdId: HID, boardId: BID, taskId: 'tsk-1' },
    });
    expect(result.delivered).toBe(true);
    expect(snoozeTaskMock).toHaveBeenCalled();
  });

  it('sends both to someone who picked both', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task]);
    notifyViaMock.mockResolvedValue('both');
    listPushTokensMock.mockResolvedValue([phone('phone-1'), phone('phone-2')]);

    const { handler } = await import('./reminder.js');
    await handler();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock).toHaveBeenCalledTimes(2);
  });

  it('sends nothing to someone who picked none, and does not snooze', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task]);
    notifyViaMock.mockResolvedValue('none');

    const { handler } = await import('./reminder.js');
    const result = await handler();

    expect(sendMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(result.delivered).toBe(false);
    expect(snoozeTaskMock).not.toHaveBeenCalled();
  });

  it('summarizes several tasks on one board in one notification that opens the board', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task, rawTask({ id: 'tsk-2', title: 'Water plants' })]);
    notifyViaMock.mockResolvedValue('app');
    listPushTokensMock.mockResolvedValue([phone('phone-1')]);

    const { handler } = await import('./reminder.js');
    await handler();

    expect(sendPushMock).toHaveBeenCalledWith(phone('phone-1'), {
      title: '2 tasks need attention',
      body: 'Take out trash, Water plants',
      path: `/households/${HID}/boards/${BID}`,
    });
  });

  it('opens the home page when the tasks are on different boards', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task, rawTask({ id: 'tsk-2', boardId: 'brd-2', title: 'Water plants' })]);
    notifyViaMock.mockResolvedValue('app');
    listPushTokensMock.mockResolvedValue([phone('phone-1')]);

    const { handler } = await import('./reminder.js');
    await handler();

    expect(sendPushMock.mock.calls[0]![1].path).toBe('/');
  });

  it('forgets a phone Firebase no longer knows', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task]);
    notifyViaMock.mockResolvedValue('app');
    listPushTokensMock.mockResolvedValue([phone('old-phone')]);
    sendPushMock.mockResolvedValue('stale');

    const { handler } = await import('./reminder.js');
    const result = await handler();

    expect(removePushTokenMock).toHaveBeenCalledWith(memberA.sub, 'old-phone');
    expect(result.delivered).toBe(false);
  });
});

describe('reminders by text', () => {
  const task = rawTask({ id: 'tsk-1', title: 'Take out trash' });

  it('texts a verified number with a link to the task, alongside email', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task]);
    textPhoneMock.mockResolvedValue('+18595550123');

    const { handler } = await import('./reminder.js');
    await handler();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).toHaveBeenCalledWith(
      '+18595550123',
      `Take out trash: Test House · due Jan 1\nhttps://example.com/households/${HID}/boards/${BID}/tasks/tsk-1`,
    );
  });

  it('still texts someone who turned email and app reminders off, and counts it as delivered', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task]);
    notifyViaMock.mockResolvedValue('none');
    textPhoneMock.mockResolvedValue('+18595550123');

    const { handler } = await import('./reminder.js');
    const result = await handler();

    expect(sendMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(result.delivered).toBe(true);
    expect(snoozeTaskMock).toHaveBeenCalled();
  });

  it('does not count a failed text as delivered', async () => {
    listMembersMock.mockResolvedValue([memberA]);
    queryAllPagesMock.mockResolvedValue([task]);
    notifyViaMock.mockResolvedValue('none');
    textPhoneMock.mockResolvedValue('+18595550123');
    sendTextMock.mockRejectedValue(new Error('no origination identity'));

    const { handler } = await import('./reminder.js');
    const result = await handler();

    expect(result.delivered).toBe(false);
    expect(snoozeTaskMock).not.toHaveBeenCalled();
  });
});

describe('reminder snooze pacing', () => {
  it('snoozes from the top of the hour so the next hourly run still sees the task', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T20:00:18.848Z'));
    try {
      listMembersMock.mockResolvedValue([memberA]);
      queryAllPagesMock.mockResolvedValue([rawTask({ id: 'tsk-1', title: 'Test task' })]);

      const { handler } = await import('./reminder.js');
      await handler();

      expect(snoozeTaskMock).toHaveBeenCalledWith(HID, expect.any(String), 'tsk-1', expect.any(Number), '2026-11-17T20:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});
