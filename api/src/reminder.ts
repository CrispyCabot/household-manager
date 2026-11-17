import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import {
  DUE_PARTITION,
  EASTERN_TIME_ZONE,
  GSI1,
  effectiveRenotifyIntervalHours,
  formatRenotifyInterval,
  formatTime,
  notifiesByApp,
  notifiesByEmail,
} from '@hhm/shared';
import type { Clock, Member, Task } from '@hhm/shared';
import { escapeHtml } from './html.js';
import { tableName } from './db/client.js';
import { listMembers, loadHousehold } from './db/households.js';
import { getClock, getNotifyVia } from './db/profiles.js';
import { listPushTokens, removePushToken } from './db/pushTokens.js';
import { listAlertsForHousehold, queryAllPages, snoozeTask } from './db/tasks.js';
import { type PushMessage, sendPush } from './push/fcm.js';
import { reconcilePendingCalendarSyncs } from './google/taskSync.js';

const sesClient = new SESv2Client({});

/**
 * Household-scoped sender local-part, e.g. "FryYayHouse" -> `fryyayhouse-reminders@…`
 * — SES verifies this domain as a whole (`infrastructure/lib/constructs/ses.ts`), not
 * individual mailboxes, so any local-part under it is authorized to send without
 * further AWS-side configuration. Falls back to the bare "reminders" local-part
 * used before per-household addresses existed if the name has no alphanumeric
 * characters to build a slug from (e.g. an emoji-only household name).
 */
function fromEmail(householdName: string): string {
  const domain = process.env.WEB_DOMAIN;
  if (domain === undefined || domain === '') throw new Error('WEB_DOMAIN is not set');
  const slug = householdName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const localPart = slug === '' ? 'reminders' : `${slug}-reminders`;
  return `${localPart}@${domain}`;
}

/**
 * Everything past its nag-start, anywhere in the account. Sparse by
 * construction — see Phase 2's design note on GSI1.
 *
 * This is an account-wide sweep (every household's currently-due tasks at
 * once, not one household's slice), so it paginates on `LastEvaluatedKey`
 * the same way `listTasksForBoard`/`listAlertsForHousehold` do, via the
 * shared `queryAllPages` helper — a result set large enough to cross
 * DynamoDB's 1MB per-Query cap must not be silently truncated.
 */
async function dueTasks(nowIso: string): Promise<Task[]> {
  const items = await queryAllPages({
    TableName: tableName(),
    IndexName: GSI1,
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK <= :now',
    ExpressionAttributeValues: { ':pk': DUE_PARTITION, ':now': nowIso },
  });
  return items.map((i) => ({
    id: String(i.id),
    householdId: String(i.householdId),
    boardId: String(i.boardId),
    title: String(i.title),
    description: String(i.description ?? ''),
    dueAt: String(i.dueAt),
    recurrence: (i.recurrence as Task['recurrence']) ?? null,
    leadTimeDays: Number(i.leadTimeDays ?? 0),
    notifyTimeOfDay: (i.notifyTimeOfDay as string | null | undefined) ?? null,
    renotifyIntervalHours: (i.renotifyIntervalHours as number | null | undefined) ?? null,
    notify: (i.notify as Task['notify']) ?? { inApp: true, email: true },
    assigneeId: (i.assigneeId as string | null | undefined) ?? null,
    status: i.status === 'completed' ? 'completed' : 'active',
    snoozedUntil: (i.snoozedUntil as string | null | undefined) ?? null,
    dismissed: Boolean(i.dismissed),
    notifyAfter: (i.notifyAfter as string | null | undefined) ?? null,
    lastCompletedAt: (i.lastCompletedAt as string | null | undefined) ?? null,
    lastCompletedBy: (i.lastCompletedBy as string | null | undefined) ?? null,
    syncToCalendar: Boolean(i.syncToCalendar),
    calendarId: (i.calendarId as string | null | undefined) ?? null,
    colorId: (i.colorId as Task['colorId'] | undefined) ?? null,
    googleEventId: (i.googleEventId as string | null | undefined) ?? null,
    googleCalendarId: (i.googleCalendarId as string | null | undefined) ?? null,
    syncState: (i.syncState as Task['syncState'] | undefined) ?? 'ok',
    syncError: (i.syncError as string | null | undefined) ?? null,
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
    version: Number(i.version),
  }));
}

function taskPath(task: Task): string {
  return `/households/${task.householdId}/boards/${task.boardId}/tasks/${task.id}`;
}

function taskUrl(task: Task): string {
  const domain = process.env.WEB_DOMAIN;
  if (domain === undefined || domain === '') throw new Error('WEB_DOMAIN is not set');
  return `https://${domain}${taskPath(task)}`;
}

function digestBody(tasks: Task[]): string {
  const lines = tasks.map(
    (t) => `- ${t.title} (due ${new Date(t.dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}) — ${taskUrl(t)}`,
  );
  return `The following tasks need attention:\n\n${lines.join('\n')}\n\nOpen a task to mark it done, snooze, or dismiss it.`;
}

/**
 * Inline-styled HTML, since email clients don't load external stylesheets;
 * colors are copied from app/src/theme/theme.css. Titles are user text, so
 * they're escaped.
 */
function digestHtml(tasks: Task[]): string {
  const count = tasks.length;
  const rows = tasks.map((t, i) => {
    const frequency = formatRenotifyInterval(effectiveRenotifyIntervalHours(t));
    return `
        <div style="padding:14px 0;${i === 0 ? '' : 'border-top:1px solid #e4dfd3;'}">
          <a href="${taskUrl(t)}" style="font-weight:700;font-size:15px;color:#211f1c;text-decoration:none;">${escapeHtml(t.title)}</a>
          <div style="font-size:13px;color:#706a5d;margin-top:2px;"> Due ${escapeHtml(new Date(t.dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' }))} &middot; notifies every ${escapeHtml(frequency)}</div>
          <a href="${taskUrl(t)}" style="display:inline-block;margin-top:8px;font-size:13px;font-weight:600;text-decoration:none;padding:8px 14px;border-radius:999px;background:#3f7d6b;color:#fff;">Open task</a>
        </div>`;
  });

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px 16px;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#211f1c;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e4dfd3;border-radius:12px;padding:24px;">
      <h1 style="margin:0;font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#211f1c;">${count} task${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention</h1>
      <div style="margin-top:8px;">${rows.join('')}</div>
      <p style="margin:20px 0 0;font-size:12px;color:#706a5d;">household-manager</p>
    </div>
  </body>
</html>`;
}

/** The app has no per-user timezone setting, so every user-facing clock time is rendered in this fixed zone rather than the Lambda runtime's UTC clock. Using the IANA zone (not a fixed UTC offset) means EST/EDT is handled automatically across the DST boundary. */
const DISPLAY_TIME_ZONE = 'America/New_York';

/**
 * Gmail groups messages into one conversation whenever the Subject is
 * byte-for-byte identical between the same sender/recipient, even with no
 * References/In-Reply-To headers (SES's `SendEmailCommand` sets neither) —
 * an hourly digest listing the same still-outstanding tasks would otherwise
 * repeat the exact same subject and collapse into a single thread, burying
 * every send after the first. The timestamp exists purely to keep the
 * subject unique per send, but it's still shown to the user, so it's
 * rendered in `DISPLAY_TIME_ZONE` rather than the Lambda's UTC clock.
 */
function digestSubject(count: number, clock: Clock): string {
  const time = formatTime(new Date(), clock, { timeZone: DISPLAY_TIME_ZONE });
  return `${count} task${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention — ${time}`;
}

async function sendDigest(toEmail: string, householdName: string, tasks: Task[], clock: Clock): Promise<void> {
  const html = digestHtml(tasks);
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: fromEmail(householdName),
      Destination: { ToAddresses: [toEmail] },
      Content: {
        Simple: {
          Subject: { Data: digestSubject(tasks.length, clock) },
          Body: { Html: { Data: html }, Text: { Data: digestBody(tasks) } },
        },
      },
    }),
  );
}

function pushMessage(householdName: string, tasks: Task[]): PushMessage {
  const [first] = tasks;
  if (tasks.length === 1 && first !== undefined) {
    const due = new Date(first.dueAt).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    return {
      title: first.title,
      body: householdName === '' ? `Due ${due}` : `${householdName} · due ${due}`,
      path: taskPath(first),
    };
  }
  const oneBoard = first !== undefined && tasks.every((t) => t.boardId === first.boardId);
  return {
    title: `${tasks.length} tasks need attention`,
    body: tasks.map((t) => t.title).join(', '),
    path: oneBoard ? `/households/${first.householdId}/boards/${first.boardId}` : '/',
  };
}

async function sendToPhones(member: Member, message: PushMessage): Promise<boolean> {
  let delivered = false;
  for (const token of await listPushTokens(member.sub)) {
    const result = await sendPush(token, message);
    if (result === 'sent') delivered = true;
    if (result === 'stale') await removePushToken(member.sub, token);
  }
  return delivered;
}

/** True if this member heard about the tasks by at least one of the ways they picked. */
async function notifyMember(member: Member, householdName: string, tasks: Task[]): Promise<boolean> {
  const via = await getNotifyVia(member.sub);
  let delivered = false;
  if (notifiesByEmail(via)) {
    try {
      await sendDigest(member.email, householdName, tasks, await getClock(member.sub));
      delivered = true;
    } catch (err) {
      // A sandboxed SES account rejects unverified recipients — log and
      // keep going rather than losing every other household's reminders
      // over one failure. See Phase 3 plan Task 3 for lifting this.
      console.error(`failed to send digest to ${member.email}`, err);
    }
  }
  if (notifiesByApp(via)) {
    try {
      if (await sendToPhones(member, pushMessage(householdName, tasks))) delivered = true;
    } catch (err) {
      console.error(`failed to send phone notifications to ${member.email}`, err);
    }
  }
  return delivered;
}

/** The EventBridge scheduled trigger invokes with no payload (or an EventBridge event shape, never this one) — `householdId` only ever arrives from the on-demand path below. */
export interface ReminderEvent {
  /** Scopes the run to one household instead of the whole account — set by `POST /v1/households/:hid/notify` (see routes/notify.ts) when a member presses "Notify now". */
  householdId?: string;
}

export interface ReminderResult {
  /** How many email-eligible tasks matched this run (post-household-scoping, if any). */
  tasksNotified: number;
  /** Whether at least one household's digest reached at least one member. Meaningless as a single flag across a full multi-household sweep — only load-bearing for the single-household on-demand path, which is the only caller that reads it. */
  delivered: boolean;
}

/**
 * Runs hourly (see infrastructure/lib/constructs/reminder.ts), or on-demand
 * for one household via routes/notify.ts's synchronous Lambda invoke — the
 * two modes deliberately use different definitions of "due":
 *
 * - The hourly sweep reads `dueTasks()` (the GSI1 sweep), which respects
 *   each task's `notifyAfter`/snooze pacing — a task already emailed this
 *   cycle stays out of the DUE partition until its renotify interval
 *   elapses, which is what keeps the hourly job from re-paging everyone
 *   every run.
 * - The on-demand path reads `listAlertsForHousehold()` instead — the same
 *   query that drives the in-app "due" banner — which ignores that pacing
 *   entirely and just checks whether the task's due date has passed. A
 *   member pressing "Notify now" expects it to act on whatever the
 *   household page is currently showing as due, not on the email system's
 *   internal pacing state, which they can't see. The trade-off: repeated
 *   presses re-email every time, with no snooze-aware throttling — a
 *   deliberate choice, prioritizing the button matching what the page shows
 *   over guarding against spam-clicking it.
 *
 * Both modes then group due tasks by household and send one digest per
 * member — several overdue chores are one email, not five (spec §8).
 * Snoozing forward only happens per-household, after that household's
 * sends, and only if at least one send actually succeeded — a total send
 * failure (bad IAM, unset `WEB_DOMAIN`, SES suspension, quota exhaustion)
 * must not be silently treated as delivered. This snooze-forward write
 * still happens for on-demand sends too, so the *next automatic* hourly
 * pass doesn't immediately re-page — only a further manual press would.
 *
 * Each member picks how reminders reach them (`Profile.notifyVia`: email,
 * the Android app, both, or none); the TASK-level `notify.email` flag still
 * gates whether a task sends reminders at all. On top of that, a task with an `assigneeId` only goes to that one
 * member — everyone else's digest skips it entirely, as if it weren't due
 * for them. An unassigned task (`assigneeId` is `null`, the default) keeps
 * the original household-wide behavior and reaches every member. This is
 * why the per-member send below filters `householdTasks` down before
 * building each member's digest, rather than sending the same list to
 * everyone.
 */
function startOfHourIso(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

export async function handler(event?: ReminderEvent): Promise<ReminderResult> {
  const now = new Date().toISOString();
  // A run starts a few seconds past :00; snoozing from that would land just after the next run starts and skip it.
  const snoozeFrom = startOfHourIso(now);
  const tasks =
    event?.householdId === undefined
      ? (await dueTasks(now)).filter((t) => t.notify.email && t.status === 'active' && !t.dismissed)
      : (await listAlertsForHousehold(event.householdId)).filter((t) => t.notify.email && !t.dismissed);

  const byHousehold = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byHousehold.get(task.householdId) ?? [];
    list.push(task);
    byHousehold.set(task.householdId, list);
  }

  let anyDelivered = false;
  for (const [householdId, householdTasks] of byHousehold) {
    const [members, household] = await Promise.all([listMembers(householdId), loadHousehold(householdId)]);
    const householdName = household?.name ?? '';
    let delivered = false;
    for (const member of members) {
      // Unassigned tasks go to everyone, same as before this field existed;
      // an assigned task is targeted at that one member only (this file's
      // own doc comment above). A member with nothing left after this
      // filter (every due task in the household is assigned to someone
      // else) gets no email at all rather than an empty digest.
      const memberTasks = householdTasks.filter((t) => t.assigneeId === null || t.assigneeId === member.sub);
      if (memberTasks.length === 0) continue;
      try {
        if (await notifyMember(member, householdName, memberTasks)) delivered = true;
      } catch (err) {
        console.error(`failed to notify ${member.email}`, err);
      }
    }

    if (!delivered) {
      console.error(`no digest delivered for household ${householdId}; not snoozing`);
      continue;
    }
    anyDelivered = true;

    // Reuses the exact write the API's own snooze endpoint performs — the
    // system is, functionally, giving each reported task a snooze on the
    // household's behalf, so it does not re-page every hour indefinitely.
    // How long depends on the task's own renotify cadence
    // (effectiveRenotifyIntervalHours: its own override if it has one, else
    // the recurrence-based default) — a daily chore gets nagged again
    // within the hour, a yearly one not for a week. Each snooze is isolated
    // so one bad/deleted task can't abort snoozing for the rest of the
    // household, and can't throw out of the handler — an uncaught throw
    // here would trigger Lambda's default async retry and double-email
    // everyone already sent to in this invocation.
    for (const task of householdTasks) {
      try {
        await snoozeTask(task.householdId, task.boardId, task.id, effectiveRenotifyIntervalHours(task), snoozeFrom);
      } catch (err) {
        console.error(`failed to snooze task ${task.id}`, err);
      }
    }
  }

  // Rides the existing hourly sweep rather than a schedule of its own
  // (FEATURE_ANALYSIS.md's Phase 3, "Failure policy") — retries any task
  // still left `pending`/`error` by a best-effort inline sync attempt
  // elsewhere (routes/tasks.ts). Account-wide, like dueTasks() above, so it
  // only runs on the real hourly trigger, not the single-household
  // on-demand "Notify now" path. Isolated in its own try/catch so nothing
  // about calendar sync can ever affect email delivery, which is
  // everything above this point in the function.
  if (event?.householdId === undefined) {
    try {
      await reconcilePendingCalendarSyncs();
    } catch (err) {
      console.error('calendar sync reconciliation failed', err);
    }
  }

  return { tasksNotified: tasks.length, delivered: anyDelivered };
}
