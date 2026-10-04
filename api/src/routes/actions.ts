import type { OpenAPIHono } from '@hono/zod-openapi';
import { effectiveRenotifyIntervalHours, formatDurationHours, formatNextNotified, formatRenotifyInterval } from '@hhm/shared';
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

/** One-tap durations on the snooze page, in hours — the task's own default interval is added to these if it isn't already one of them. */
const SNOOZE_PRESET_HOURS = [1, 3, 6, 12, 24, 48, 24 * 7];
/** Same ceiling as the API's SnoozeTaskSchema (30 days), so every value this page accepts is one the in-app snooze would accept too. */
const MAX_SNOOZE_HOURS = 24 * 30;

const presetButton = (hours: number, isDefault: boolean) =>
  `<button type="submit" name="hours" value="${hours}" style="font-family:inherit;font-size:0.9rem;font-weight:600;padding:10px 16px;margin:4px;border:1px solid #3f7d6b;border-radius:999px;cursor:pointer;${
    isDefault ? 'background:#3f7d6b;color:#fff;' : 'background:#ffffff;color:#3f7d6b;'
  }">${escapeHtml(formatDurationHours(hours))}</button>`;

/** The snooze picker: preset durations plus a custom number of hours. Each preset is its own submit button, so this needs no JavaScript to work in an email client's in-app browser. */
function snoozePicker(defaultHours: number): string {
  const presets = [...new Set([...SNOOZE_PRESET_HOURS, defaultHours])].filter((h) => h <= MAX_SNOOZE_HOURS).sort((a, b) => a - b);
  return `<div style="margin-top:16px;">${presets.map((h) => presetButton(h, h === defaultHours)).join('')}</div>
     <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e4dfd3;">
       <label style="display:block;font-size:0.85rem;color:#706a5d;margin-bottom:8px;" for="custom-hours">Or a custom number of hours (up to ${MAX_SNOOZE_HOURS})</label>
       <input id="custom-hours" name="customHours" type="number" min="1" max="${MAX_SNOOZE_HOURS}" step="1" inputmode="numeric" placeholder="e.g. 5" style="font-family:inherit;font-size:1rem;width:6em;padding:9px 10px;border:1px solid #e4dfd3;border-radius:8px;text-align:center;" />
       <button type="submit" name="hours" value="custom" style="font-family:inherit;font-size:0.9rem;font-weight:600;padding:10px 16px;margin-left:6px;border:1px solid #3f7d6b;border-radius:999px;cursor:pointer;background:#ffffff;color:#3f7d6b;">Snooze</button>
     </div>`;
}

/** Reads the hours the picker form submitted — a preset's own value, or the custom field when "custom" was pressed (or Enter was hit inside it). Returns null for anything missing, non-numeric, or outside 1..MAX_SNOOZE_HOURS. */
function parseSnoozeHours(form: Record<string, unknown>): number | null {
  const raw = form.hours === 'custom' || form.hours === undefined ? form.customHours : form.hours;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 1 || hours > MAX_SNOOZE_HOURS) return null;
  return Math.round(hours);
}

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
    if (payload.action === 'snooze') {
      const defaultHours = Math.min(effectiveRenotifyIntervalHours(task), MAX_SNOOZE_HOURS);
      return c.html(
        page(
          copy.heading,
          `<h1 style="margin:0 0 8px;font-size:1.2rem;">${copy.heading}</h1>
           <p style="color:#706a5d;font-size:0.9rem;">How long should we stay quiet? This task normally notifies every ${escapeHtml(formatRenotifyInterval(defaultHours))}.</p>
           <form method="post">${snoozePicker(defaultHours)}</form>
           ${linkButton('Open in app instead', `${webOrigin()}/households/${task.householdId}/boards/${task.boardId}`)}`,
        ),
      );
    }
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
        // The picker page posts an explicit duration. Falling back to the
        // task's own interval keeps an old-style one-shot POST working.
        const form = await c.req.parseBody();
        const picked = parseSnoozeHours(form);
        if (Object.keys(form).length > 0 && picked === null) {
          return c.html(
            page(
              'Pick a duration',
              `<h1 style="margin:0 0 8px;font-size:1.2rem;">Pick a number of hours</h1>
               <p style="color:#706a5d;font-size:0.9rem;">Enter a whole number from 1 to ${MAX_SNOOZE_HOURS}.</p>
               ${linkButton('Back', `/actions/${c.req.param('token')}`)}`,
            ),
            400,
          );
        }
        const hours = picked ?? effectiveRenotifyIntervalHours(task);
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
