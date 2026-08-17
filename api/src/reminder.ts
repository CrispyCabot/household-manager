import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DUE_PARTITION, GSI1 } from '@hhm/shared';
import type { Task } from '@hhm/shared';
import { tableName } from './db/client.js';
import { listMembers } from './db/households.js';
import { queryAllPages, snoozeTask } from './db/tasks.js';

const sesClient = new SESv2Client({});

function fromEmail(): string {
  const domain = process.env.WEB_DOMAIN;
  if (domain === undefined || domain === '') throw new Error('WEB_DOMAIN is not set');
  return `reminders@${domain}`;
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

function digestBody(tasks: Task[]): string {
  const lines = tasks.map((t) => `- ${t.title} (due ${new Date(t.dueAt).toLocaleDateString()})`);
  return `The following tasks need attention:\n\n${lines.join('\n')}\n\nOpen household-manager to mark them done, snooze, or dismiss.`;
}

async function sendDigest(toEmail: string, tasks: Task[]): Promise<void> {
  const count = tasks.length;
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: fromEmail(),
      Destination: { ToAddresses: [toEmail] },
      Content: {
        Simple: {
          Subject: { Data: `${count} task${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention` },
          Body: { Text: { Data: digestBody(tasks) } },
        },
      },
    }),
  );
}

/**
 * Runs hourly (see infrastructure/lib/constructs/reminder.ts). Groups due
 * tasks by household and sends one digest per member — several overdue
 * chores are one email, not five (spec §8). Snoozing forward only happens
 * per-household, after that household's sends, and only if at least one
 * send actually succeeded — a total send failure (bad IAM, unset
 * `WEB_DOMAIN`, SES suspension, quota exhaustion) must not be silently
 * treated as delivered.
 *
 * There is no per-member email preference in this app (Phases 1–2 never
 * added one to Profile); the gate is the TASK-level `notify.email` flag
 * instead, and every member of the household receives it. Adding a
 * per-member override is a small, self-contained follow-up if it turns out
 * to matter — it does not change anything built here.
 */
export async function handler(): Promise<void> {
  const now = new Date().toISOString();
  const tasks = (await dueTasks(now)).filter((t) => t.notify.email && t.status === 'active' && !t.dismissed);

  const byHousehold = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byHousehold.get(task.householdId) ?? [];
    list.push(task);
    byHousehold.set(task.householdId, list);
  }

  for (const [householdId, householdTasks] of byHousehold) {
    const members = await listMembers(householdId);
    let delivered = false;
    for (const member of members) {
      try {
        await sendDigest(member.email, householdTasks);
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

    // Reuses the exact write the API's own snooze endpoint performs — the
    // system is, functionally, giving each reported task a 24h snooze on
    // the household's behalf, so it does not re-page every hour
    // indefinitely. Each snooze is isolated so one bad/deleted task can't
    // abort snoozing for the rest of the household, and can't throw out of
    // the handler — an uncaught throw here would trigger Lambda's default
    // async retry and double-email everyone already sent to in this
    // invocation.
    for (const task of householdTasks) {
      try {
        await snoozeTask(task.householdId, task.boardId, task.id, 24);
      } catch (err) {
        console.error(`failed to snooze task ${task.id}`, err);
      }
    }
  }
}
