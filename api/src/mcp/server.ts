import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Board, ChecklistItem, CreateTaskInput, HouseholdSummary, Member, Recurrence, Task } from '@hhm/shared';

export type ApiCaller = (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;

class ToolError extends Error {}

async function call<T>(api: ApiCaller, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await api(path, init);
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    if (res.status === 404) throw new ToolError('Not found. Check the household, board and task ids (list_boards and list_tasks show them).');
    throw new ToolError(payload.error?.message ?? `Request failed with status ${res.status}`);
  }
  return payload as T;
}

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const message = err instanceof ToolError ? err.message : 'Something went wrong talking to household-manager.';
  if (!(err instanceof ToolError)) console.error('mcp tool error', err);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  return fn().then(ok, fail);
}

const DateInput = z
  .string()
  .describe('Due date as YYYY-MM-DD (preferred), or a full ISO 8601 date-time.')
  .refine((s) => toDueAt(s) !== null, 'Must be YYYY-MM-DD or an ISO 8601 date-time');

export function toDueAt(input: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const d = new Date(`${input}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function easternToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function describeRecurrence(r: Recurrence | null): string | null {
  if (r === null) return null;
  const unit = r.every === 1 ? r.unit : `${r.every} ${r.unit}s`;
  return `every ${unit}, counted from ${r.anchor === 'completion' ? 'when it was last completed' : 'the scheduled due date'}`;
}

function summarizeTask(t: Task, members: Member[], boardTitle?: string): Record<string, unknown> {
  const assignee = t.assigneeId === null ? null : (members.find((m) => m.sub === t.assigneeId)?.email ?? t.assigneeId);
  return {
    taskId: t.id,
    boardId: t.boardId,
    ...(boardTitle === undefined ? {} : { board: boardTitle }),
    title: t.title,
    ...(t.description === '' ? {} : { description: t.description }),
    dueDate: t.dueAt.slice(0, 10),
    status: t.status,
    repeats: describeRecurrence(t.recurrence),
    assignee,
    ...(t.snoozedUntil === null ? {} : { snoozedUntil: t.snoozedUntil }),
    ...(t.lastCompletedAt === null ? {} : { lastCompletedAt: t.lastCompletedAt }),
  };
}

interface Me {
  email: string;
  lastHouseholdId: string | null;
  households: HouseholdSummary[];
}

async function resolveHousehold(api: ApiCaller, householdId: string | undefined): Promise<string> {
  if (householdId !== undefined) return householdId;
  const me = await call<Me>(api, '/v1/me');
  if (me.households.length === 1) return me.households[0]!.id;
  if (me.lastHouseholdId !== null && me.households.some((h) => h.id === me.lastHouseholdId)) return me.lastHouseholdId;
  if (me.households.length === 0) throw new ToolError('This account is not a member of any household yet.');
  throw new ToolError('This account belongs to several households. Call list_households and pass householdId.');
}

const listBoards = (api: ApiCaller, hid: string) => call<{ boards: Board[] }>(api, `/v1/households/${hid}/boards`).then((r) => r.boards);
const listTasks = (api: ApiCaller, hid: string, bid: string) => call<{ tasks: Task[] }>(api, `/v1/households/${hid}/boards/${bid}/tasks`).then((r) => r.tasks);
const listMembers = (api: ApiCaller, hid: string) => call<{ members: Member[] }>(api, `/v1/households/${hid}/members`).then((r) => r.members);

async function resolveAssignee(api: ApiCaller, hid: string, email: string | null | undefined): Promise<string | null | undefined> {
  if (email === undefined) return undefined;
  if (email === null || email === '') return null;
  const members = await listMembers(api, hid);
  const match = members.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
  if (match === undefined) {
    throw new ToolError(`No household member has the email ${email}. Members: ${members.map((m) => m.email).join(', ')}`);
  }
  return match.sub;
}

async function findTask(api: ApiCaller, hid: string, bid: string, tid: string): Promise<Task> {
  const task = (await listTasks(api, hid, bid)).find((t) => t.id === tid);
  if (task === undefined) throw new ToolError('Task not found on that board. Call list_tasks to see its tasks.');
  return task;
}

const householdIdArg = z
  .string()
  .optional()
  .describe("Household id from list_households. Optional: defaults to the member's only household, or the one they last used.");
const boardIdArg = z.string().describe('Board id from list_boards.');
const taskIdArg = z.string().describe('Task id from list_tasks or list_due_tasks.');

const RecurrenceArg = z
  .object({
    every: z.number().int().positive().describe('How many units between occurrences, e.g. 2 for every 2 weeks.'),
    unit: z.enum(['day', 'week', 'month', 'year']),
    anchor: z
      .enum(['completion', 'schedule'])
      .default('completion')
      .describe("'completion' counts from when it was last done (chores); 'schedule' keeps fixed dates (bills)."),
  })
  .describe('Makes the task repeat. Omit for a one-off task.');

export function createMcpServer(api: ApiCaller): McpServer {
  const server = new McpServer(
    { name: 'household-manager', version: '1.0.0' },
    {
      instructions:
        'Tools for a shared household manager. A household holds boards: tasks boards (chores and bills with due dates), ' +
        'checklist boards (shopping lists), and others. Start with list_boards to find board ids. Due dates are calendar days ' +
        '(YYYY-MM-DD) in US Eastern time. Completing a repeating task schedules its next occurrence.',
    },
  );

  server.registerTool(
    'list_households',
    {
      title: 'List households',
      description: 'Lists the households this account belongs to.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const me = await call<Me>(api, '/v1/me');
        return { households: me.households, lastUsedHouseholdId: me.lastHouseholdId };
      }),
  );

  server.registerTool(
    'list_boards',
    {
      title: 'List boards',
      description: 'Lists the boards in a household, in display order, with each board id and type (tasks, checklist, text, link, calendar).',
      inputSchema: { householdId: householdIdArg },
      annotations: { readOnlyHint: true },
    },
    ({ householdId }) =>
      run(async () => {
        const hid = await resolveHousehold(api, householdId);
        const boards = await listBoards(api, hid);
        return { householdId: hid, boards: boards.map((b) => ({ boardId: b.id, title: b.title, type: b.type })) };
      }),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks on a board',
      description: 'Lists the tasks on one tasks board, soonest due first.',
      inputSchema: {
        householdId: householdIdArg,
        boardId: boardIdArg,
        status: z.enum(['active', 'completed', 'all']).default('active').describe('Defaults to active (not yet done) tasks.'),
        dueOnOrBefore: z.string().optional().describe('Only tasks due on or before this YYYY-MM-DD date.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ householdId, boardId, status, dueOnOrBefore }) =>
      run(async () => {
        const hid = await resolveHousehold(api, householdId);
        const [tasks, members] = await Promise.all([listTasks(api, hid, boardId), listMembers(api, hid)]);
        const filtered = tasks
          .filter((t) => status === 'all' || t.status === status)
          .filter((t) => dueOnOrBefore === undefined || t.dueAt.slice(0, 10) <= dueOnOrBefore)
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
        return { householdId: hid, boardId, tasks: filtered.map((t) => summarizeTask(t, members)) };
      }),
  );

  server.registerTool(
    'list_due_tasks',
    {
      title: "What's due",
      description: 'Lists active tasks across every tasks board in a household that are overdue or due within the next few days, soonest first.',
      inputSchema: {
        householdId: householdIdArg,
        withinDays: z.number().int().min(0).max(365).default(7).describe('How many days ahead to look. 0 means today only. Defaults to 7.'),
        includeOverdue: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true },
    },
    ({ householdId, withinDays, includeOverdue }) =>
      run(async () => {
        const hid = await resolveHousehold(api, householdId);
        const today = easternToday();
        const until = addDays(today, withinDays);
        const [boards, members] = await Promise.all([listBoards(api, hid), listMembers(api, hid)]);
        const taskBoards = boards.filter((b) => b.type === 'tasks');
        const perBoard = await Promise.all(taskBoards.map(async (b) => ({ board: b, tasks: await listTasks(api, hid, b.id) })));
        const due = perBoard
          .flatMap(({ board, tasks }) => tasks.map((t) => ({ board, task: t })))
          .filter(({ task }) => task.status === 'active')
          .filter(({ task }) => {
            const day = task.dueAt.slice(0, 10);
            return day <= until && (includeOverdue || day >= today);
          })
          .sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt))
          .map(({ board, task }) => ({ ...summarizeTask(task, members, board.title), overdue: task.dueAt.slice(0, 10) < today }));
        return { householdId: hid, today, through: until, tasks: due };
      }),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Add a task',
      description: 'Adds a task to a tasks board. Reminders follow the household defaults unless leadTimeDays is set.',
      inputSchema: {
        householdId: householdIdArg,
        boardId: boardIdArg,
        title: z.string().min(1).max(160),
        dueDate: DateInput,
        description: z.string().max(2000).optional(),
        recurrence: RecurrenceArg.optional(),
        leadTimeDays: z.number().int().min(0).max(365).optional().describe('Start reminding this many days before the due date. Defaults to 0.'),
        assigneeEmail: z.string().optional().describe('Email of the household member this is for. Omit to leave it unassigned (the whole household is reminded).'),
      },
    },
    (args) =>
      run(async () => {
        const hid = await resolveHousehold(api, args.householdId);
        const assigneeId = await resolveAssignee(api, hid, args.assigneeEmail);
        const body: Partial<CreateTaskInput> = {
          title: args.title,
          dueAt: toDueAt(args.dueDate)!,
          ...(args.description === undefined ? {} : { description: args.description }),
          ...(args.recurrence === undefined ? {} : { recurrence: args.recurrence }),
          ...(args.leadTimeDays === undefined ? {} : { leadTimeDays: args.leadTimeDays }),
          ...(assigneeId === undefined ? {} : { assigneeId }),
        };
        const { task } = await call<{ task: Task }>(api, `/v1/households/${hid}/boards/${args.boardId}/tasks`, { method: 'POST', body });
        const members = assigneeId ? await listMembers(api, hid) : [];
        return { created: summarizeTask(task, members) };
      }),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Edit a task',
      description: "Changes a task's title, description, due date, repeat schedule, reminder lead time or assignee. Only the fields you pass change.",
      inputSchema: {
        householdId: householdIdArg,
        boardId: boardIdArg,
        taskId: taskIdArg,
        title: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).optional(),
        dueDate: DateInput.optional(),
        recurrence: RecurrenceArg.nullable().optional().describe('Pass null to stop it repeating.'),
        leadTimeDays: z.number().int().min(0).max(365).optional(),
        assigneeEmail: z.string().nullable().optional().describe('Pass null to unassign.'),
      },
    },
    (args) =>
      run(async () => {
        const hid = await resolveHousehold(api, args.householdId);
        const existing = await findTask(api, hid, args.boardId, args.taskId);
        const assigneeId = await resolveAssignee(api, hid, args.assigneeEmail);
        const body = {
          title: args.title ?? existing.title,
          description: args.description ?? existing.description,
          dueAt: args.dueDate === undefined ? existing.dueAt : toDueAt(args.dueDate)!,
          recurrence: args.recurrence === undefined ? existing.recurrence : args.recurrence,
          leadTimeDays: args.leadTimeDays ?? existing.leadTimeDays,
          notifyTimeOfDay: existing.notifyTimeOfDay,
          renotifyIntervalHours: existing.renotifyIntervalHours,
          notify: existing.notify,
          assigneeId: assigneeId === undefined ? existing.assigneeId : assigneeId,
          syncToCalendar: existing.syncToCalendar,
          calendarId: existing.calendarId,
          colorId: existing.colorId,
          version: existing.version,
        };
        const { task } = await call<{ task: Task }>(api, `/v1/households/${hid}/boards/${args.boardId}/tasks/${args.taskId}`, { method: 'PATCH', body });
        return { updated: summarizeTask(task, await listMembers(api, hid)) };
      }),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Mark a task done',
      description: 'Marks a task done. A repeating task moves to its next due date; a one-off task becomes completed. Reversible with uncomplete_task.',
      inputSchema: { householdId: householdIdArg, boardId: boardIdArg, taskId: taskIdArg },
    },
    ({ householdId, boardId, taskId }) =>
      run(async () => {
        const hid = await resolveHousehold(api, householdId);
        const { task } = await call<{ task: Task }>(api, `/v1/households/${hid}/boards/${boardId}/tasks/${taskId}/complete`, { method: 'POST' });
        return { completed: summarizeTask(task, await listMembers(api, hid)) };
      }),
  );

  server.registerTool(
    'uncomplete_task',
    {
      title: 'Undo marking a task done',
      description: "Undoes a task's most recent completion, restoring its previous due date and status.",
      inputSchema: { householdId: householdIdArg, boardId: boardIdArg, taskId: taskIdArg },
    },
    ({ householdId, boardId, taskId }) =>
      run(async () => {
        const hid = await resolveHousehold(api, householdId);
        const { task } = await call<{ task: Task }>(api, `/v1/households/${hid}/boards/${boardId}/tasks/${taskId}/uncomplete`, { method: 'POST' });
        return { restored: summarizeTask(task, await listMembers(api, hid)) };
      }),
  );

  server.registerTool(
    'list_checklist_items',
    {
      title: 'List checklist items',
      description: 'Lists the items on a checklist board (such as a shopping list).',
      inputSchema: {
        householdId: householdIdArg,
        boardId: boardIdArg,
        includeChecked: z.boolean().default(false).describe('Also include items already checked off.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ householdId, boardId, includeChecked }) =>
      run(async () => {
        const hid = await resolveHousehold(api, householdId);
        const { items } = await call<{ items: ChecklistItem[] }>(api, `/v1/households/${hid}/boards/${boardId}/items`);
        return {
          householdId: hid,
          boardId,
          items: items.filter((i) => includeChecked || !i.checked).map((i) => ({ itemId: i.id, text: i.text, checked: i.checked })),
        };
      }),
  );

  server.registerTool(
    'add_checklist_item',
    {
      title: 'Add to a checklist',
      description: 'Adds an item to a checklist board (such as a shopping list).',
      inputSchema: { householdId: householdIdArg, boardId: boardIdArg, text: z.string().min(1).max(500) },
    },
    ({ householdId, boardId, text }) =>
      run(async () => {
        const hid = await resolveHousehold(api, householdId);
        const { item } = await call<{ item: ChecklistItem }>(api, `/v1/households/${hid}/boards/${boardId}/items`, { method: 'POST', body: { text } });
        return { added: { itemId: item.id, text: item.text } };
      }),
  );

  return server;
}
