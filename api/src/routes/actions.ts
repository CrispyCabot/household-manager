import type { OpenAPIHono } from '@hono/zod-openapi';
import { effectiveRenotifyIntervalHours, formatNextNotified } from '@hhm/shared';
import type { Task } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { InvalidActionTokenError, type TaskAction, verifyActionToken } from '../actionToken.js';
import { completeTask, dismissTask, loadTask, snoozeTask } from '../db/tasks.js';
import { escapeHtml } from '../html.js';

export interface ActionDb {
  loadTask: typeof loadTask;
  completeTask: typeof completeTask;
  snoozeTask: typeof snoozeTask;
  dismissTask: typeof dismissTask;
}

export const defaultActionDb: ActionDb = { loadTask, completeTask, snoozeTask, dismissTask };

function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? '';
}

/** A single self-contained HTML document, styled to loosely match the app (see theme.css) without depending on it — this page is served standalone, outside the SPA. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:24px 16px;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#211f1c;">
    <div style="max-width:420px;margin:10vh auto 0;background:#ffffff;border:1px solid #e4dfd3;border-radius:12px;padding:24px;text-align:center;">
      ${body}
    </div>
  </body>
</html>`;
}

const confirmButton = (label: string) =>
  `<button type="submit" style="font-family:inherit;font-size:0.9rem;font-weight:600;padding:11px 18px;border:1px solid #3f7d6b;border-radius:999px;cursor:pointer;background:#3f7d6b;color:#fff;">${escapeHtml(label)}</button>`;

const linkButton = (label: string, href: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:14px;font-size:0.85rem;font-weight:600;color:#3f7d6b;text-decoration:none;">${escapeHtml(label)}</a>`;

function expiredPage() {
  return page(
    'Link expired',
    `<h1 style="margin:0 0 8px;font-size:1.2rem;">This link has expired</h1>
     <p style="color:#706a5d;font-size:0.9rem;">Open the app to manage your tasks directly.</p>
     ${linkButton('Open household-manager', webOrigin())}`,
  );
}

function notFoundPage() {
  return page(
    'Task not found',
    `<h1 style="margin:0 0 8px;font-size:1.2rem;">This task no longer exists</h1>
     ${linkButton('Open household-manager', webOrigin())}`,
  );
}

function actionCopy(
  action: TaskAction,
  title: string,
  task: Pick<Task, 'recurrence' | 'renotifyIntervalHours'>,
): { heading: string; detail: string; confirmLabel: string } {
  const escaped = escapeHtml(title);
  switch (action) {
    case 'complete':
      return { heading: `Mark "${escaped}" complete?`, detail: '', confirmLabel: 'Mark complete' };
    case 'dismiss':
      return {
        heading: `Dismiss "${escaped}"?`,
        detail: "This stops reminder emails until it's next due. It'll still show in the app until you complete it.",
        confirmLabel: 'Dismiss',
      };
    case 'snooze': {
      // Same computation and formatting the in-app snooze picker's default
      // uses (AlertBanner.tsx) — effectiveRenotifyIntervalHours and
      // formatNextNotified are shared, not reimplemented per surface.
      const hours = effectiveRenotifyIntervalHours(task);
      return {
        heading: `Snooze "${escaped}"?`,
        detail: `You won't be notified again until ${formatNextNotified(Date.now() + hours * 3_600_000)}.`,
        confirmLabel: 'Snooze',
      };
    }
  }
}

/**
 * Unauthenticated by design — mounted outside `/v1/households/*`'s
 * `requireAuth` middleware (see app.ts). The signed token IS the
 * authorization; anyone who has it can perform exactly the one action it
 * names, on exactly the one task it names, until it expires.
 *
 * GET only ever renders a confirmation page — it must never itself perform
 * the task action. Email clients and corporate link-scanners routinely
 * prefetch every URL in an email to check for malware; if GET mutated
 * state, that prefetch alone would silently complete/snooze/dismiss tasks
 * nobody clicked. Only the POST a human triggers by clicking the page's own
 * button performs the action.
 */
export function registerActionRoutes(app: OpenAPIHono<AuthedEnv>, db: ActionDb = defaultActionDb): void {
  app.get('/actions/:token', async (c) => {
    let payload;
    try {
      payload = await verifyActionToken(c.req.param('token'));
    } catch (err) {
      if (err instanceof InvalidActionTokenError) return c.html(expiredPage());
      throw err;
    }

    const task = await db.loadTask(payload.householdId, payload.boardId, payload.taskId);
    if (task === null) return c.html(notFoundPage());

    const copy = actionCopy(payload.action, task.title, task);
    return c.html(
      page(
        copy.heading,
        `<h1 style="margin:0 0 8px;font-size:1.2rem;">${copy.heading}</h1>
         ${copy.detail === '' ? '' : `<p style="color:#706a5d;font-size:0.9rem;">${copy.detail}</p>`}
         <form method="post" style="margin-top:16px;">${confirmButton(copy.confirmLabel)}</form>
         ${linkButton('Open in app instead', `${webOrigin()}/households/${task.householdId}/boards/${task.boardId}`)}`,
      ),
    );
  });

  app.post('/actions/:token', async (c) => {
    let payload;
    try {
      payload = await verifyActionToken(c.req.param('token'));
    } catch (err) {
      if (err instanceof InvalidActionTokenError) return c.html(expiredPage());
      throw err;
    }

    const task = await db.loadTask(payload.householdId, payload.boardId, payload.taskId);
    if (task === null) return c.html(notFoundPage());

    let resultText: string;
    switch (payload.action) {
      case 'complete':
        await db.completeTask(payload.householdId, payload.boardId, payload.taskId, 'email-action');
        resultText = `"${escapeHtml(task.title)}" marked complete.`;
        break;
      case 'dismiss':
        await db.dismissTask(payload.householdId, payload.boardId, payload.taskId);
        resultText = `Reminder emails for "${escapeHtml(task.title)}" are paused until it's next due.`;
        break;
      case 'snooze': {
        const hours = effectiveRenotifyIntervalHours(task);
        await db.snoozeTask(payload.householdId, payload.boardId, payload.taskId, hours);
        resultText = `"${escapeHtml(task.title)}" snoozed until ${formatNextNotified(Date.now() + hours * 3_600_000)}.`;
        break;
      }
    }

    return c.html(
      page(
        'Done',
        `<h1 style="margin:0 0 8px;font-size:1.2rem;">Done</h1>
         <p style="color:#706a5d;font-size:0.9rem;">${resultText}</p>
         ${linkButton('Open household-manager', webOrigin())}`,
      ),
    );
  });
}
