import { describe, expect, it, vi } from 'vitest';
import type { Board, CreateTaskInput, Member, Task, UpdateTaskInput } from '@hhm/shared';
import { createApp } from '../app.js';
import type { AuthedUser, Principal } from '../auth.js';
import type { TaskDb } from './tasks.js';

const HID = 'hh-1';
const BID = 'brd-1';
const TID = 'tsk-1';
const userPrincipal: AuthedUser = { kind: 'user', sub: 'user-1', email: 'a@example.com' };
const otherMember: Member = { sub: 'user-2', email: 'b@example.com', joinedAt: '2026-01-01T00:00:00.000Z' };
const USER_TOKEN = 'user-token';

async function verify(token: string): Promise<Principal> {
  if (token === USER_TOKEN) return userPrincipal;
  throw new Error('unknown test token');
}

const now = '2026-01-01T00:00:00.000Z';

const fakeBoard: Board = {
  id: BID,
  householdId: HID,
  type: 'tasks',
  title: 'Chores',
  position: 0,
  config: {},
  createdAt: now,
  updatedAt: now,
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TID,
    householdId: HID,
    boardId: BID,
    title: 'Take out trash',
    description: '',
    dueAt: now,
    recurrence: null,
    leadTimeDays: 0,
    notifyTimeOfDay: null,
    renotifyIntervalHours: null,
    notify: { inApp: true, email: true },
    assigneeId: null,
    status: 'active',
    snoozedUntil: null,
    dismissed: false,
    notifyAfter: null,
    lastCompletedAt: null,
    lastCompletedBy: null,
    syncToCalendar: null,
    googleEventId: null,
    googleCalendarId: null,
    syncState: 'ok',
    syncError: null,
    createdBy: userPrincipal.sub,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function buildApp(taskDb: Partial<TaskDb>) {
  const fullTaskDb: TaskDb = {
    loadBoard: async () => fakeBoard,
    listMembers: async () => [{ sub: userPrincipal.sub, email: userPrincipal.email, joinedAt: now }, otherMember],
    // null (not a task) by default: the route falls back to createTask/
    // updateTask's own return value in that case (see routes/tasks.ts,
    // `synced = (await db.loadTask(...)) ?? task`), which is what these
    // tests want to assert against. A non-null stub here would silently
    // override whatever createTask/updateTask returned.
    loadTask: async () => null,
    createTask: async ({ task }: { task: CreateTaskInput }) => makeTask({ assigneeId: task.assigneeId }),
    listTasksForBoard: async () => [],
    updateTask: async (_hid: string, _bid: string, _tid: string, input: UpdateTaskInput) =>
      makeTask({ assigneeId: input.assigneeId, version: input.version + 1 }),
    completeTask: async () => makeTask(),
    snoozeTask: async () => makeTask(),
    dismissTask: async () => makeTask(),
    deleteTask: async () => true,
    syncTaskWrite: async () => {},
    syncTaskDeletion: async () => {},
    ...taskDb,
  };
  return createApp({ verify, checkMembership: async () => true, taskDb: fullTaskDb });
}

function authedRequest(app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json', ...init.headers },
  });
}

describe('creating a task with an assignee', () => {
  it('accepts assigneeId when it names a current member', async () => {
    const createTask = vi.fn(async ({ task }: { task: CreateTaskInput }) => makeTask({ assigneeId: task.assigneeId }));
    const app = buildApp({ createTask });
    const res = await authedRequest(app, `/v1/households/${HID}/boards/${BID}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Take out trash', dueAt: now, assigneeId: otherMember.sub }),
    });
    expect(res.status).toBe(201);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ assigneeId: otherMember.sub }) }));
    const body = (await res.json()) as { task: Task };
    expect(body.task.assigneeId).toBe(otherMember.sub);
  });

  it('defaults assigneeId to null (unassigned) when omitted', async () => {
    const createTask = vi.fn(async ({ task }: { task: CreateTaskInput }) => makeTask({ assigneeId: task.assigneeId }));
    const app = buildApp({ createTask });
    const res = await authedRequest(app, `/v1/households/${HID}/boards/${BID}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Take out trash', dueAt: now }),
    });
    expect(res.status).toBe(201);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ assigneeId: null }) }));
  });

  it('rejects an assigneeId that is not a current member with a 400, and never calls createTask', async () => {
    const createTask = vi.fn(async ({ task }: { task: CreateTaskInput }) => makeTask({ assigneeId: task.assigneeId }));
    const app = buildApp({ createTask });
    const res = await authedRequest(app, `/v1/households/${HID}/boards/${BID}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Take out trash', dueAt: now, assigneeId: 'not-a-member' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_assignee');
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe('updating a task with an assignee', () => {
  it('accepts reassigning to a current member', async () => {
    const updateTask = vi.fn(async (_hid: string, _bid: string, _tid: string, input: UpdateTaskInput) =>
      makeTask({ assigneeId: input.assigneeId, version: input.version + 1 }),
    );
    const app = buildApp({ updateTask });
    const res = await authedRequest(app, `/v1/households/${HID}/boards/${BID}/tasks/${TID}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Take out trash', dueAt: now, assigneeId: otherMember.sub, version: 1 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: Task };
    expect(body.task.assigneeId).toBe(otherMember.sub);
  });

  it('accepts clearing an assignee back to null', async () => {
    const updateTask = vi.fn(async (_hid: string, _bid: string, _tid: string, input: UpdateTaskInput) =>
      makeTask({ assigneeId: input.assigneeId, version: input.version + 1 }),
    );
    const app = buildApp({ updateTask });
    const res = await authedRequest(app, `/v1/households/${HID}/boards/${BID}/tasks/${TID}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Take out trash', dueAt: now, assigneeId: null, version: 1 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: Task };
    expect(body.task.assigneeId).toBeNull();
  });

  it('rejects reassigning to someone who is not a current member with a 400', async () => {
    const updateTask = vi.fn(async (_hid: string, _bid: string, _tid: string, input: UpdateTaskInput) =>
      makeTask({ assigneeId: input.assigneeId, version: input.version + 1 }),
    );
    const app = buildApp({ updateTask });
    const res = await authedRequest(app, `/v1/households/${HID}/boards/${BID}/tasks/${TID}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Take out trash', dueAt: now, assigneeId: 'not-a-member', version: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_assignee');
    expect(updateTask).not.toHaveBeenCalled();
  });
});
