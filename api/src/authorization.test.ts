import { describe, expect, it } from 'vitest';
import type { Board, Household, Task } from '@hhm/shared';
import { createApp } from './app.js';
import type { AuthedUser, Principal } from './auth.js';

/**
 * The test FEATURE_ANALYSIS.md called out by name: asserts that a device
 * principal is rejected from every route not explicitly listed as
 * device-eligible in that document's "Authorization — the real refactor"
 * table. A new mutating route added later and forgotten here will show up
 * as a failure the moment it's exercised — that's the point: the default
 * this suite enforces is deny, not allow.
 */

const HID = 'hh-1';
const BID = 'bd-1';
const TID = 'tk-1';
const IID = 'it-1';
const DID = 'dv-1';

const USER_TOKEN = 'user-token';
const DEVICE_TOKEN = 'device-token';

const userPrincipal: AuthedUser = { kind: 'user', sub: 'user-sub', email: 'a@example.com' };

async function verify(token: string): Promise<Principal> {
  if (token === DEVICE_TOKEN) return { kind: 'device', deviceId: DID, householdId: HID };
  if (token === USER_TOKEN) return userPrincipal;
  throw new Error('unknown test token');
}

const now = new Date().toISOString();

const fakeHousehold: Household = { id: HID, name: 'Test', createdBy: userPrincipal.sub, createdAt: now, updatedAt: now, version: 1 };
const fakeBoard: Board = { id: BID, householdId: HID, type: 'tasks', title: 'Chores', position: 0, config: {}, createdAt: now, updatedAt: now };
const fakeChecklistItem = {
  id: IID,
  householdId: HID,
  boardId: BID,
  text: 'Milk',
  checked: false,
  position: 0,
  checkedAt: null,
  createdBy: userPrincipal.sub,
  createdAt: now,
  updatedAt: now,
};
const fakeTextDoc = { blocks: [], updatedBy: null, updatedAt: null };
const fakeLinkDoc = { url: null, icon: 'website' as const };
const fakeDevice = {
  id: DID,
  householdId: HID,
  name: 'Kitchen',
  kind: 'dashboard' as const,
  schedule: [],
  layout: null,
  theme: null,
  lastSeenAt: null,
  lastSeenAgent: null,
  createdBy: userPrincipal.sub,
  createdAt: now,
  updatedAt: now,
};
const fakeTask: Task = {
  id: TID,
  householdId: HID,
  boardId: BID,
  title: 'Take out bins',
  description: '',
  dueAt: now,
  recurrence: null,
  leadTimeDays: 0,
  notifyTimeOfDay: null,
  notify: { inApp: true, email: true },
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
};

function buildApp() {
  return createApp({
    verify,
    checkMembership: async (householdId, sub) => householdId === HID && sub === userPrincipal.sub,
    meDb: {
      claimInvites: async (..._args: any[]) => {},
      listHouseholdsForUser: async (..._args: any[]) => [{ id: HID, name: fakeHousehold.name }],
      upsertProfile: async (..._args: any[]) => ({ sub: userPrincipal.sub, email: userPrincipal.email, lastHouseholdId: HID, theme: null }),
      setLastHousehold: async (..._args: any[]) => {},
      setTheme: async (..._args: any[]) => {},
    },
    householdDb: {
      createHousehold: async (..._args: any[]) => fakeHousehold,
      listHouseholdsForUser: async (..._args: any[]) => [{ id: HID, name: fakeHousehold.name }],
      loadHousehold: async (..._args: any[]) => fakeHousehold,
      renameHousehold: async (..._args: any[]) => fakeHousehold,
      deleteHousehold: async (..._args: any[]) => {},
    },
    boardDb: {
      createBoard: async (..._args: any[]) => fakeBoard,
      listBoards: async (..._args: any[]) => [fakeBoard],
      loadBoard: async (..._args: any[]) => fakeBoard,
      renameBoard: async (..._args: any[]) => fakeBoard,
      reorderBoards: async (..._args: any[]) => [fakeBoard],
      deleteBoard: async (..._args: any[]) => true,
      updateBoardConfig: async (..._args: any[]) => fakeBoard,
    },
    taskDb: {
      loadBoard: async (..._args: any[]) => fakeBoard,
      loadTask: async (..._args: any[]) => fakeTask,
      createTask: async (..._args: any[]) => fakeTask,
      listTasksForBoard: async (..._args: any[]) => [fakeTask],
      updateTask: async (..._args: any[]) => fakeTask,
      completeTask: async (..._args: any[]) => fakeTask,
      snoozeTask: async (..._args: any[]) => fakeTask,
      dismissTask: async (..._args: any[]) => fakeTask,
      deleteTask: async (..._args: any[]) => true,
      syncTaskWrite: async (..._args: any[]) => {},
      syncTaskDeletion: async (..._args: any[]) => {},
    },
    checklistDb: {
      loadBoard: async () => ({ ...fakeBoard, type: 'checklist' }),
      createChecklistItem: async (..._args: any[]) => fakeChecklistItem,
      listChecklistItems: async (..._args: any[]) => [fakeChecklistItem],
      renameChecklistItem: async (..._args: any[]) => fakeChecklistItem,
      toggleChecklistItem: async (..._args: any[]) => fakeChecklistItem,
      deleteChecklistItem: async (..._args: any[]) => true,
    },
    textDb: {
      loadBoard: async () => ({ ...fakeBoard, type: 'text' }),
      loadTextDoc: async (..._args: any[]) => fakeTextDoc,
      saveTextDoc: async (..._args: any[]) => fakeTextDoc,
    },
    linkDb: {
      loadBoard: async () => ({ ...fakeBoard, type: 'link' }),
      loadLinkDoc: async (..._args: any[]) => fakeLinkDoc,
      saveLinkDoc: async (..._args: any[]) => fakeLinkDoc,
    },
    memberDb: {
      listMembers: async (..._args: any[]) => [],
      loadHousehold: async (..._args: any[]) => fakeHousehold,
      removeMember: async (..._args: any[]) => {},
    },
    inviteDb: {
      createInvite: async (..._args: any[]) => ({ householdId: HID, email: 'x@example.com', invitedAt: now }),
      listInvites: async (..._args: any[]) => [],
      revokeInvite: async (..._args: any[]) => {},
    },
    notifyDb: {
      notifyHousehold: async (..._args: any[]) => ({ tasksNotified: 0, delivered: false }),
    },
    googleDb: {
      buildGoogleAuthUrl: async (..._args: any[]) => 'https://accounts.google.com/o/oauth2/v2/auth?fake=1',
      completeGoogleOAuth: async (..._args: any[]) => HID,
      getGoogleConnection: async (..._args: any[]) => null,
      disconnectGoogle: async (..._args: any[]) => true,
      listHouseholdCalendars: async (..._args: any[]) => [],
    },
    calendarDb: {
      loadBoard: async (..._args: any[]) => ({ ...fakeBoard, type: 'calendar' }),
      listBoardEvents: async (..._args: any[]) => [],
    },
    deviceDb: {
      createPairing: async (..._args: any[]) => ({ code: 'ABCD-1234', expiresAt: now }),
      pollPairing: async (..._args: any[]) => ({ status: 'pending' as const }),
      claimPairing: async (..._args: any[]) => ({ device: fakeDevice, deviceSecret: 'shh' }),
      verifyDeviceCredential: async (..._args: any[]) => null,
      touchDeviceLastSeen: async (..._args: any[]) => {},
      listDevices: async (..._args: any[]) => [],
      loadDevice: async (..._args: any[]) => fakeDevice,
      updateDevice: async (..._args: any[]) => fakeDevice,
      deleteDevice: async (..._args: any[]) => true,
    },
  });
}

/** Builds a `RequestInit` without ever setting `body: undefined` explicitly — `exactOptionalPropertyTypes` treats that as distinct from omitting the key. */
function requestInit(method: string, token: string, body: unknown): RequestInit {
  const base: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body === undefined) return base;
  return { ...base, headers: { ...base.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

interface Endpoint {
  method: string;
  path: string;
  /** Whether a device principal is allowed to call this — per FEATURE_ANALYSIS.md's authorization table. */
  deviceAllowed: boolean;
  body?: unknown;
}

const endpoints: Endpoint[] = [
  // households — user-only except a single-household GET.
  { method: 'GET', path: '/v1/households', deviceAllowed: false },
  { method: 'POST', path: '/v1/households', deviceAllowed: false, body: { name: 'New' } },
  { method: 'GET', path: `/v1/households/${HID}`, deviceAllowed: true },
  { method: 'PATCH', path: `/v1/households/${HID}`, deviceAllowed: false, body: { name: 'Renamed', version: 1 } },
  { method: 'DELETE', path: `/v1/households/${HID}`, deviceAllowed: false },

  // /v1/me — user-only, not device-scoped at all.
  { method: 'GET', path: '/v1/me', deviceAllowed: false },
  { method: 'PUT', path: '/v1/me/last-household', deviceAllowed: false, body: { householdId: HID } },
  { method: 'PUT', path: '/v1/me/theme', deviceAllowed: false, body: { theme: null } },

  // boards — reads open, writes user-only.
  { method: 'GET', path: `/v1/households/${HID}/boards`, deviceAllowed: true },
  { method: 'GET', path: `/v1/households/${HID}/boards/${BID}`, deviceAllowed: true },
  { method: 'POST', path: `/v1/households/${HID}/boards`, deviceAllowed: false, body: { type: 'tasks', title: 'New' } },
  { method: 'PUT', path: `/v1/households/${HID}/boards/order`, deviceAllowed: false, body: { boardIds: [BID] } },
  { method: 'PATCH', path: `/v1/households/${HID}/boards/${BID}`, deviceAllowed: false, body: { title: 'Renamed' } },
  { method: 'PATCH', path: `/v1/households/${HID}/boards/${BID}/config`, deviceAllowed: false, body: {} },
  { method: 'DELETE', path: `/v1/households/${HID}/boards/${BID}`, deviceAllowed: false },

  // tasks — reads and complete/snooze/dismiss are device-eligible; author/delete are not.
  { method: 'GET', path: `/v1/households/${HID}/boards/${BID}/tasks`, deviceAllowed: true },
  { method: 'POST', path: `/v1/households/${HID}/boards/${BID}/tasks`, deviceAllowed: false, body: { title: 'New', dueAt: now } },
  { method: 'PATCH', path: `/v1/households/${HID}/boards/${BID}/tasks/${TID}`, deviceAllowed: false, body: { title: 'Edited', dueAt: now, version: 1 } },
  { method: 'POST', path: `/v1/households/${HID}/boards/${BID}/tasks/${TID}/complete`, deviceAllowed: true },
  { method: 'POST', path: `/v1/households/${HID}/boards/${BID}/tasks/${TID}/snooze`, deviceAllowed: true, body: { hours: 24 } },
  { method: 'POST', path: `/v1/households/${HID}/boards/${BID}/tasks/${TID}/dismiss`, deviceAllowed: true },
  { method: 'DELETE', path: `/v1/households/${HID}/boards/${BID}/tasks/${TID}`, deviceAllowed: false },

  // checklist — reads and toggle are device-eligible; author/rename/delete are not.
  { method: 'GET', path: `/v1/households/${HID}/boards/${BID}/items`, deviceAllowed: true },
  { method: 'POST', path: `/v1/households/${HID}/boards/${BID}/items`, deviceAllowed: false, body: { text: 'Milk' } },
  { method: 'PATCH', path: `/v1/households/${HID}/boards/${BID}/items/${IID}`, deviceAllowed: false, body: { text: 'Eggs' } },
  { method: 'POST', path: `/v1/households/${HID}/boards/${BID}/items/${IID}/toggle`, deviceAllowed: true },
  { method: 'DELETE', path: `/v1/households/${HID}/boards/${BID}/items/${IID}`, deviceAllowed: false },

  // text & link boards — reads open, saves user-only.
  { method: 'GET', path: `/v1/households/${HID}/boards/${BID}/doc`, deviceAllowed: true },
  { method: 'PUT', path: `/v1/households/${HID}/boards/${BID}/doc`, deviceAllowed: false, body: { blocks: [] } },
  { method: 'GET', path: `/v1/households/${HID}/boards/${BID}/link`, deviceAllowed: true },
  { method: 'PUT', path: `/v1/households/${HID}/boards/${BID}/link`, deviceAllowed: false, body: { url: 'https://example.com', icon: 'website' } },

  // members & invites — user-only.
  { method: 'GET', path: `/v1/households/${HID}/members`, deviceAllowed: false },
  { method: 'DELETE', path: `/v1/households/${HID}/members/some-sub`, deviceAllowed: false },
  { method: 'GET', path: `/v1/households/${HID}/invites`, deviceAllowed: false },
  { method: 'POST', path: `/v1/households/${HID}/invites`, deviceAllowed: false, body: { email: 'x@example.com' } },
  { method: 'DELETE', path: `/v1/households/${HID}/invites/x%40example.com`, deviceAllowed: false },

  // notify — user-only.
  { method: 'POST', path: `/v1/households/${HID}/notify`, deviceAllowed: false },

  // google connection — user-only (not in the device authorization table;
  // only the resulting calendar board data is device-readable, below).
  { method: 'GET', path: `/v1/households/${HID}/google/auth-url`, deviceAllowed: false },
  { method: 'GET', path: `/v1/households/${HID}/google`, deviceAllowed: false },
  { method: 'DELETE', path: `/v1/households/${HID}/google`, deviceAllowed: false },
  { method: 'GET', path: `/v1/households/${HID}/google/calendars`, deviceAllowed: false },

  // calendar board events — device-readable, like every other board type's read endpoint.
  { method: 'GET', path: `/v1/households/${HID}/boards/${BID}/events?from=2026-01-01&to=2026-01-31`, deviceAllowed: true },

  // device management — user-only (a device cannot manage its own siblings or itself).
  { method: 'POST', path: `/v1/households/${HID}/devices/claim`, deviceAllowed: false, body: { code: 'ABCD-1234', name: 'Kitchen' } },
  { method: 'GET', path: `/v1/households/${HID}/devices`, deviceAllowed: false },
  { method: 'PATCH', path: `/v1/households/${HID}/devices/${DID}`, deviceAllowed: false, body: { name: 'Renamed' } },
  { method: 'DELETE', path: `/v1/households/${HID}/devices/${DID}`, deviceAllowed: false },
];

describe('device authorization', () => {
  const app = buildApp();

  for (const endpoint of endpoints) {
    it(`${endpoint.deviceAllowed ? 'allows' : 'rejects'} a device calling ${endpoint.method} ${endpoint.path}`, async () => {
      const res = await app.request(endpoint.path, requestInit(endpoint.method, DEVICE_TOKEN, endpoint.body));

      if (endpoint.deviceAllowed) {
        expect(res.status, `expected device to be allowed, got ${res.status}: ${await res.clone().text()}`).not.toBe(403);
      } else {
        expect(res.status, `expected device to be rejected with 403, got ${res.status}: ${await res.clone().text()}`).toBe(403);
      }
    });

    it(`allows a signed-in member calling ${endpoint.method} ${endpoint.path}`, async () => {
      const res = await app.request(endpoint.path, requestInit(endpoint.method, USER_TOKEN, endpoint.body));
      expect(res.status, `expected member to be allowed, got ${res.status}: ${await res.clone().text()}`).not.toBe(403);
    });
  }

  it('rejects a request with no bearer token at all', async () => {
    const res = await app.request(`/v1/households/${HID}/boards`);
    expect(res.status).toBe(401);
  });

  it('device /v1/devices/me works for a device and is rejected for a user', async () => {
    const asDevice = await app.request('/v1/devices/me', { headers: { Authorization: `Bearer ${DEVICE_TOKEN}` } });
    expect(asDevice.status).toBe(200);

    const asUser = await app.request('/v1/devices/me', { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
    expect(asUser.status).toBe(403);
  });

  it('the pairing endpoints require no authentication at all', async () => {
    const res = await app.request('/v1/devices/pair', { method: 'POST' });
    expect(res.status).toBe(201);
  });
});
