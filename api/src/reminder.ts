import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DUE_PARTITION, GSI1, renotifyIntervalHours } from '@hhm/shared';
import type { Task } from '@hhm/shared';
import { type TaskAction, signActionToken } from './actionToken.js';
import { escapeHtml } from './html.js';
import { tableName } from './db/client.js';
import { listMembers, loadHousehold } from './db/households.js';
import { listAlertsForHousehold, queryAllPages, snoozeTask } from './db/tasks.js';

const sesClient = new SESv2Client({});

/** How long a digest's Complete/Snooze/Dismiss links stay clickable — generous enough to survive a busy week, bounded enough to cap a leaked link's exposure. */
const ACTION_TOKEN_TTL_HOURS = 24 * 14;

function apiBaseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (url === undefined || url === '') throw new Error('API_BASE_URL is not set');
  return url;
}

async function actionUrl(task: Task, action: TaskAction): Promise<string> {
  const token = await signActionToken({
    householdId: task.householdId,
    boardId: task.boardId,
    taskId: task.id,
    action,
    exp: Math.floor(Date.now() / 1000) + ACTION_TOKEN_TTL_HOURS * 3600,
  });
  return `${apiBaseUrl()}/actions/${token}`;
}

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
    notify: (i.notify as Task['notify']) ?? { inApp: true, email: true },
    status: i.status === 'completed' ? 'completed' : 'active',
    snoozedUntil: (i.snoozedUntil as string | null | undefined) ?? null,
    dismissed: Boolean(i.dismissed),
    notifyAfter: (i.notifyAfter as string | null | undefined) ?? null,
    lastCompletedAt: (i.lastCompletedAt as string | null | undefined) ?? null,
    lastCompletedBy: (i.lastCompletedBy as string | null | undefined) ?? null,
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
    version: Number(i.version),
  }));
}

function boardUrl(task: Task): string {
  const domain = process.env.WEB_DOMAIN;
  if (domain === undefined || domain === '') throw new Error('WEB_DOMAIN is not set');
  return `https://${domain}/households/${task.householdId}/boards/${task.boardId}`;
}

function digestBody(tasks: Task[]): string {
  const lines = tasks.map(
    (t) => `- ${t.title} (due ${new Date(t.dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}) — ${boardUrl(t)}`,
  );
  return `The following tasks need attention:\n\n${lines.join('\n')}\n\nOpen household-manager to mark them done, snooze, or dismiss.`;
}

const actionBtn = (label: string, href: string, style: string) =>
  `<a href="${href}" style="display:inline-block;font-size:13px;font-weight:600;text-decoration:none;padding:8px 14px;border-radius:999px;margin:8px 8px 0 0;${style}">${escapeHtml(label)}</a>`;

/**
 * Inline-styled, table-free HTML — email clients don't load external
 * stylesheets, so every color/spacing value here is copied from
 * app/src/theme/theme.css by hand rather than shared with it. Task titles
 * are user-controlled text landing directly in the markup, so they're
 * HTML-escaped (an unescaped "<img onerror=...>" title would otherwise
 * execute in whatever renders this email).
 *
 * Complete/Dismiss are plain `<a>` links, not `<form>` buttons — mailto-safe
 * HTML has no way to POST, so each link's href is a GET to the API's
 * /actions/:token, which renders a confirm-then-POST page rather than
 * performing the action itself (see actions.ts's own doc comment on why:
 * email clients/scanners prefetch every link, and a GET that mutated state
 * would fire on that prefetch alone). "Open in app" stays the least visually
 * prominent of the three — it's the fallback path, not the point of the row.
 *
 * There's no Snooze button here — see FEATURE_ROADMAP.md's "Disabled
 * functionality" section: the handler already auto-renotifies on the
 * interval below, so a manual snooze from an email that just sent is
 * redundant with the pacing the system already does for you.
 */
async function digestHtml(tasks: Task[]): Promise<string> {
  const count = tasks.length;
  const rows = await Promise.all(
    tasks.map(async (t, i) => {
      const [complete, dismiss] = await Promise.all([actionUrl(t, 'complete'), actionUrl(t, 'dismiss')]);
      return `
        <div style="padding:14px 0;${i === 0 ? '' : 'border-top:1px solid #e4dfd3;'}">
          <div style="font-weight:700;font-size:15px;color:#211f1c;">${escapeHtml(t.title)}</div>
          <div style="font-size:13px;color:#706a5d;margin-top:2px;">Due ${escapeHtml(new Date(t.dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' }))}</div>
          <div>
            ${actionBtn('Complete', complete, 'background:#3f7d6b;color:#fff;')}
            ${actionBtn('Dismiss', dismiss, 'background:#ffffff;color:#211f1c;border:1px solid #e4dfd3;')}
          </div>
          <a href="${boardUrl(t)}" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:600;color:#706a5d;text-decoration:none;">Open in app &rarr;</a>
        </div>`;
    }),
  );

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
function digestSubject(count: number): string {
  const time = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: DISPLAY_TIME_ZONE,
  });
  return `${count} task${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention — ${time}`;
}

async function sendDigest(toEmail: string, householdName: string, tasks: Task[]): Promise<void> {
  const html = await digestHtml(tasks);
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: fromEmail(householdName),
      Destination: { ToAddresses: [toEmail] },
      Content: {
        Simple: {
          Subject: { Data: digestSubject(tasks.length) },
          Body: { Html: { Data: html }, Text: { Data: digestBody(tasks) } },
        },
      },
    }),
  );
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
 * There is no per-member email preference in this app (Phases 1–2 never
 * added one to Profile); the gate is the TASK-level `notify.email` flag
 * instead, and every member of the household receives it. Adding a
 * per-member override is a small, self-contained follow-up if it turns out
 * to matter — it does not change anything built here.
 */
export async function handler(event?: ReminderEvent): Promise<ReminderResult> {
  const now = new Date().toISOString();
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
      try {
        await sendDigest(member.email, householdName, householdTasks);
        delivered = true;
      } catch (err) {
        // A sandboxed SES account rejects unverified recipients — log and
        // keep going rather than losing every other household's reminders
        // over one failure. See Phase 3 plan Task 3 for lifting this.
        console.error(`failed to send digest to ${member.email}`, err);
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
    // How long depends on how often the task recurs (renotifyIntervalHours)
    // — a daily chore gets nagged again within the hour, a yearly one not
    // for a week. Each snooze is isolated so one bad/deleted task can't
    // abort snoozing for the rest of the household, and can't throw out of
    // the handler — an uncaught throw here would trigger Lambda's default
    // async retry and double-email everyone already sent to in this
    // invocation.
    for (const task of householdTasks) {
      try {
        await snoozeTask(task.householdId, task.boardId, task.id, renotifyIntervalHours(task.recurrence));
      } catch (err) {
        console.error(`failed to snooze task ${task.id}`, err);
      }
    }
  }

  return { tasksNotified: tasks.length, delivered: anyDelivered };
}
