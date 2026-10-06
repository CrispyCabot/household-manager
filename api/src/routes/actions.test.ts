import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import type { ActionDb } from './actions.js';
import { registerActionRoutes } from './actions.js';

vi.mock('../actionToken.js', () => ({
  InvalidActionTokenError: class InvalidActionTokenError extends Error {},
  verifyActionToken: async () => ({ householdId: 'hh-1', boardId: 'brd-1', taskId: 'tsk-1', action: 'snooze', exp: 9_999_999_999 }),
}));

const task = {
  id: 'tsk-1',
  householdId: 'hh-1',
  boardId: 'brd-1',
  title: 'Take out trash',
  recurrence: null,
  renotifyIntervalHours: 6,
} as Task;

function setup() {
  const snoozeTask = vi.fn(async () => task);
  const db = {
    loadTask: async () => task,
    completeTask: vi.fn(),
    dismissTask: vi.fn(),
    snoozeTask,
  } as unknown as ActionDb;
  const app = new OpenAPIHono<AuthedEnv>();
  registerActionRoutes(app, db);
  const post = (body?: Record<string, string>) =>
    app.request('/actions/tok', {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }),
    });
  return { app, snoozeTask, post };
}

describe('snooze action page', () => {
  it('GET renders a duration picker (and does not snooze)', async () => {
    const { app, snoozeTask } = setup();
    const res = await app.request('/actions/tok');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('name="hours" value="1"');
    expect(html).toContain('name="hours" value="6"');
    expect(html).toContain('name="customHours"');
    expect(snoozeTask).not.toHaveBeenCalled();
  });

  it('POST with a preset snoozes for that many hours', async () => {
    const { post, snoozeTask } = setup();
    const res = await post({ hours: '12' });
    expect(res.status).toBe(200);
    expect(snoozeTask).toHaveBeenCalledWith('hh-1', 'brd-1', 'tsk-1', 12);
  });

  it('POST with a custom value snoozes for that many hours', async () => {
    const { post, snoozeTask } = setup();
    await post({ hours: 'custom', customHours: '5' });
    expect(snoozeTask).toHaveBeenCalledWith('hh-1', 'brd-1', 'tsk-1', 5);
  });

  it('POST with a custom value of 0 clears the snooze', async () => {
    const { post, snoozeTask } = setup();
    const res = await post({ hours: 'custom', customHours: '0' });
    expect(res.status).toBe(200);
    expect(snoozeTask).toHaveBeenCalledWith('hh-1', 'brd-1', 'tsk-1', 0);
  });

  it.each(['-3', 'abc', '', '99999'])('POST rejects a custom value of %j without snoozing', async (customHours) => {
    const { post, snoozeTask } = setup();
    const res = await post({ hours: 'custom', customHours });
    expect(res.status).toBe(400);
    expect(snoozeTask).not.toHaveBeenCalled();
  });

  it('POST with no form body falls back to the task default interval', async () => {
    const { post, snoozeTask } = setup();
    const res = await post();
    expect(res.status).toBe(200);
    expect(snoozeTask).toHaveBeenCalledWith('hh-1', 'brd-1', 'tsk-1', 6);
  });
});
