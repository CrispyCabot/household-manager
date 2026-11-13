import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, CreateTaskInput, Member, Task, UpdateTaskInput } from '@hhm/shared';
import { createApp } from '../app.js';
import type { AuthedUser, Principal } from '../auth.js';
import type { BoardDb } from '../routes/boards.js';
import type { MeDb } from '../routes/me.js';
import type { MemberDb } from '../routes/members.js';
import type { TaskDb } from '../routes/tasks.js';
import { easternToday, toDueAt } from './server.js';

const HID = 'hh-1';
const BID = 'brd-1';
const USER_TOKEN = 'user-token';
const DEVICE_TOKEN = 'device-token';
const user: AuthedUser = { kind: 'user', sub: 'user-1', email: 'a@example.com' };
const members: Member[] = [
  { sub: 'user-1', email: 'a@example.com', joinedAt: '2026-01-01T00:00:00.000Z' },
  { sub: 'user-2', email: 'b@example.com', joinedAt: '2026-01-01T00:00:00.000Z' },
];
const now = '2026-01-01T00:00:00.000Z';

async function verify(token: string): Promise<Principal> {
  if (token === USER_TOKEN) return user;
  if (token === DEVICE_TOKEN) return { kind: 'device', deviceId: 'dev-1', householdId: HID };
  throw new Error('unknown token');
}

function board(overrides: Partial<Board> = {}): Board {
  return { id: BID, householdId: HID, type: 'tasks', title: 'Chores', position: 0, config: {}, createdAt: now, updatedAt: now, ...overrides };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk-1',
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
    syncToCalendar: false,
    calendarId: null,
    colorId: null,
    googleEventId: null,
    googleCalendarId: null,
    syncState: 'ok',
    syncError: null,
    createdBy: user.sub,
    createdAt: now,
    updatedAt: now,
    version: 3,
    ...overrides,
  };
}

function dayOffset(days: number): string {
  const d = new Date(`${easternToday()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

interface Fakes {
  tasks?: Task[];
  boards?: Board[];
  taskDb?: Partial<TaskDb>;
}

function buildApp(fakes: Fakes = {}) {
  const boards = fakes.boards ?? [board()];
  const tasks = fakes.tasks ?? [];
  const meDb: MeDb = {
    claimInvites: async () => {},
    listHouseholdsForUser: async () => [{ id: HID, name: 'Home' }],
    upsertProfile: async () => ({ sub: user.sub, email: user.email, lastHouseholdId: HID, theme: null }),
    setLastHousehold: async () => {},
    setTheme: async () => {},
  } as unknown as MeDb;
  const boardDb = {
    listBoards: async () => boards,
    loadBoard: async (_hid: string, bid: string) => boards.find((b) => b.id === bid) ?? null,
  } as unknown as BoardDb;
  const memberDb = { listMembers: async () => members } as unknown as MemberDb;
  const taskDb: TaskDb = {
    loadBoard: async (_hid, bid) => boards.find((b) => b.id === bid) ?? null,
    listMembers: async () => members,
    loadTask: async () => null,
    createTask: async ({ task: input }: { task: CreateTaskInput }) => task({ ...input, id: 'new-task' }),
    listTasksForBoard: async (_hid, bid) => tasks.filter((t) => t.boardId === bid),
    updateTask: async (_h, _b, tid, input: UpdateTaskInput) => task({ ...input, id: tid, version: input.version + 1 }),
    completeTask: async (_h, _b, tid) => task({ id: tid, status: 'completed' }),
    uncompleteTask: async (_h, _b, tid) => task({ id: tid }),
    snoozeTask: async () => task(),
    dismissTask: async () => task(),
    deleteTask: async () => true,
    syncTaskWrite: async () => {},
    syncTaskDeletion: async () => {},
    recordTaskAudit: async () => {},
    listTaskAudit: async () => [],
    ...fakes.taskDb,
  } as TaskDb;
  return createApp({ verify, checkMembership: async () => true, meDb, boardDb, memberDb, taskDb });
}

let rpcId = 0;
async function rpc(app: ReturnType<typeof createApp>, method: string, params: unknown, token = USER_TOKEN) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return res;
}

async function callTool(app: ReturnType<typeof createApp>, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(app, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  const text = body.result.content[0]?.text ?? '';
  return { isError: body.result.isError === true, text, json: () => JSON.parse(text) as Record<string, any> };
}

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', 'https://api.example.test');
  vi.stubEnv('COGNITO_DOMAIN', 'https://login.example.test');
  vi.stubEnv('MCP_CLIENT_ID', 'mcp-client');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/mcp auth', () => {
  it('answers an unauthenticated call with a 401 that points at the protected-resource metadata', async () => {
    const res = await buildApp().request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata="https://api.example.test/.well-known/oauth-protected-resource"');
  });

  it('rejects an invalid token', async () => {
    const res = await rpc(buildApp(), 'tools/list', {}, 'nope');
    expect(res.status).toBe(401);
  });

  it('rejects a wall-dashboard device token', async () => {
    const res = await rpc(buildApp(), 'tools/list', {}, DEVICE_TOKEN);
    expect(res.status).toBe(401);
  });

  it('answers GET with 405, since the server is stateless', async () => {
    const res = await buildApp().request('/mcp', { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
    expect(res.status).toBe(405);
  });
});

describe('/mcp protocol', () => {
  it('initializes', async () => {
    const res = await rpc(buildApp(), 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe('household-manager');
  });

  it('lists the tools', async () => {
    const res = await rpc(buildApp(), 'tools/list', {});
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(
      [
        'add_checklist_item',
        'complete_task',
        'create_task',
        'list_boards',
        'list_checklist_items',
        'list_due_tasks',
        'list_households',
        'list_tasks',
        'uncomplete_task',
        'update_task',
      ].sort(),
    );
  });
});

describe('tools', () => {
  it('list_boards defaults to the only household', async () => {
    const result = await callTool(buildApp({ boards: [board(), board({ id: 'brd-2', type: 'checklist', title: 'Groceries' })] }), 'list_boards');
    expect(result.json()).toEqual({
      householdId: HID,
      boards: [
        { boardId: BID, title: 'Chores', type: 'tasks' },
        { boardId: 'brd-2', title: 'Groceries', type: 'checklist' },
      ],
    });
  });

  it('list_due_tasks returns overdue and upcoming active tasks across tasks boards, soonest first', async () => {
    const boards = [board(), board({ id: 'brd-2', title: 'Bills' }), board({ id: 'brd-3', type: 'checklist', title: 'Groceries' })];
    const tasks = [
      task({ id: 'later', dueAt: dayOffset(3), boardId: 'brd-2' }),
      task({ id: 'overdue', dueAt: dayOffset(-2) }),
      task({ id: 'too-far', dueAt: dayOffset(30) }),
      task({ id: 'done', dueAt: dayOffset(1), status: 'completed' }),
      task({ id: 'mine', dueAt: dayOffset(0), assigneeId: 'user-2' }),
    ];
    const result = await callTool(buildApp({ boards, tasks }), 'list_due_tasks', { withinDays: 7 });
    const due = result.json().tasks as { taskId: string; overdue: boolean; board: string; assignee: string | null }[];
    expect(due.map((t) => t.taskId)).toEqual(['overdue', 'mine', 'later']);
    expect(due[0]).toMatchObject({ overdue: true, board: 'Chores' });
    expect(due[1]).toMatchObject({ overdue: false, assignee: 'b@example.com' });
    expect(due[2]).toMatchObject({ board: 'Bills' });
  });

  it('list_due_tasks can leave out overdue tasks', async () => {
    const tasks = [task({ id: 'overdue', dueAt: dayOffset(-2) }), task({ id: 'soon', dueAt: dayOffset(1) })];
    const result = await callTool(buildApp({ tasks }), 'list_due_tasks', { includeOverdue: false });
    expect((result.json().tasks as { taskId: string }[]).map((t) => t.taskId)).toEqual(['soon']);
  });

  it('create_task goes through the REST route, turning a date into the stored due time and an email into an assignee', async () => {
    const createTask = vi.fn(async ({ task: input }: { task: CreateTaskInput }) => task({ ...input, id: 'new-task' }));
    const recordTaskAudit = vi.fn(async () => {});
    const result = await callTool(buildApp({ taskDb: { createTask, recordTaskAudit } }), 'create_task', {
      boardId: BID,
      title: 'Clean gutters',
      dueDate: '2026-11-20',
      recurrence: { every: 6, unit: 'month' },
      assigneeEmail: 'B@example.com',
    });
    expect(result.isError).toBe(false);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: HID,
        boardId: BID,
        createdBy: user.sub,
        task: expect.objectContaining({
          title: 'Clean gutters',
          dueAt: '2026-11-20T00:00:00.000Z',
          recurrence: { every: 6, unit: 'month', anchor: 'completion' },
          assigneeId: 'user-2',
        }),
      }),
    );
    // Audit entries are written by the REST route, so the connector's edits show up in the app's history.
    expect(recordTaskAudit).toHaveBeenCalledWith(HID, BID, 'new-task', { actor: user.sub, action: 'created' });
    expect(result.json().created).toMatchObject({ taskId: 'new-task', dueDate: '2026-11-20', assignee: 'b@example.com', repeats: expect.stringContaining('every 6 months') });
  });

  it('create_task reports an unknown assignee email instead of creating anything', async () => {
    const createTask = vi.fn();
    const result = await callTool(buildApp({ taskDb: { createTask } }), 'create_task', {
      boardId: BID,
      title: 'x',
      dueDate: '2026-11-20',
      assigneeEmail: 'stranger@example.com',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('stranger@example.com');
    expect(createTask).not.toHaveBeenCalled();
  });

  it('create_task rejects an unparseable date', async () => {
    const res = await rpc(buildApp(), 'tools/call', { name: 'create_task', arguments: { boardId: BID, title: 'x', dueDate: 'next tuesday' } });
    const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.error !== undefined || body.result?.isError === true).toBe(true);
  });

  it('update_task changes only the fields passed and sends the version it read', async () => {
    const existing = task({ id: 'tsk-1', title: 'Old', description: 'keep me', leadTimeDays: 2, version: 7 });
    const updateTask = vi.fn(async (_h: string, _b: string, tid: string, input: UpdateTaskInput) => task({ ...input, id: tid }));
    const result = await callTool(buildApp({ tasks: [existing], taskDb: { updateTask } }), 'update_task', {
      boardId: BID,
      taskId: 'tsk-1',
      title: 'New',
      dueDate: '2026-12-01',
    });
    expect(result.isError).toBe(false);
    expect(updateTask).toHaveBeenCalledWith(
      HID,
      BID,
      'tsk-1',
      expect.objectContaining({ title: 'New', description: 'keep me', leadTimeDays: 2, dueAt: '2026-12-01T00:00:00.000Z', version: 7 }),
    );
  });

  it('complete_task completes through the REST route', async () => {
    const completeTask = vi.fn(async (_h: string, _b: string, tid: string) => task({ id: tid, status: 'completed' }));
    const result = await callTool(buildApp({ taskDb: { completeTask } }), 'complete_task', { boardId: BID, taskId: 'tsk-1' });
    expect(completeTask).toHaveBeenCalledWith(HID, BID, 'tsk-1', user.sub);
    expect(result.json().completed).toMatchObject({ taskId: 'tsk-1', status: 'completed' });
  });

  it('turns a missing board into a readable tool error', async () => {
    const result = await callTool(buildApp(), 'list_tasks', { boardId: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Not found');
  });
});

describe('toDueAt', () => {
  it('stores a bare date as midnight UTC, like the app does', () => {
    expect(toDueAt('2026-03-05')).toBe('2026-03-05T00:00:00.000Z');
  });
  it('normalizes a date-time and rejects nonsense', () => {
    expect(toDueAt('2026-03-05T12:00:00-05:00')).toBe('2026-03-05T17:00:00.000Z');
    expect(toDueAt('soon')).toBeNull();
  });
});
