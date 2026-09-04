import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  ClaimDeviceSchema,
  DeviceSchema,
  DeviceTokenRequestSchema,
  DeviceTokenResponseSchema,
  IdSchema,
  PairResponseSchema,
  PairStatusSchema,
  ReportDeviceScreenSchema,
  ScheduleModeSchema,
  UpdateDeviceSchema,
  evaluateScheduleAt,
} from '@hhm/shared';
import { DEVICE_TOKEN_TTL_SECONDS, signDeviceToken } from '../deviceToken.js';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import {
  claimPairing,
  createPairing,
  deleteDevice,
  listDevices,
  loadDevice,
  pollPairing,
  touchDeviceLastSeen,
  updateDevice,
  verifyDeviceCredential,
} from '../db/devices.js';

export interface DeviceDb {
  createPairing: typeof createPairing;
  pollPairing: typeof pollPairing;
  claimPairing: typeof claimPairing;
  verifyDeviceCredential: typeof verifyDeviceCredential;
  touchDeviceLastSeen: typeof touchDeviceLastSeen;
  listDevices: typeof listDevices;
  loadDevice: typeof loadDevice;
  updateDevice: typeof updateDevice;
  deleteDevice: typeof deleteDevice;
}

export const defaultDeviceDb: DeviceDb = {
  createPairing,
  pollPairing,
  claimPairing,
  verifyDeviceCredential,
  touchDeviceLastSeen,
  listDevices,
  loadDevice,
  updateDevice,
  deleteDevice,
};

const hidParams = z.object({ hid: IdSchema });
const deviceParams = z.object({ hid: IdSchema, did: IdSchema });
const codeParams = z.object({ code: z.string().min(1).max(16) });

// --- unauthenticated: pairing & token exchange ----------------------------
// Rate limiting for these three lives at the HTTP API level (see
// FEATURE_ANALYSIS.md's "Pairing flow") — nothing in this app process
// throttles by IP.

const pairRoute = createRoute({
  method: 'post',
  path: '/v1/devices/pair',
  responses: {
    201: { content: { 'application/json': { schema: PairResponseSchema } }, description: 'A pairing code, shown on the device for someone to claim from their phone' },
  },
});

const pollRoute = createRoute({
  method: 'get',
  path: '/v1/devices/pair/{code}',
  request: { params: codeParams },
  responses: {
    200: { content: { 'application/json': { schema: PairStatusSchema } }, description: 'Pending, or claimed (carries the device credential exactly once)' },
    404: { description: 'Unknown, already-delivered, or expired code' },
  },
});

const tokenRoute = createRoute({
  method: 'post',
  path: '/v1/devices/token',
  request: { body: { content: { 'application/json': { schema: DeviceTokenRequestSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: DeviceTokenResponseSchema } }, description: 'A short-lived device JWT' },
    401: { description: 'Unknown device or wrong secret' },
  },
});

/** Registers the endpoints a device itself calls with no prior session — pairing and token exchange. Mounted outside `requireAuth`, like `routes/actions.ts`. */
export function registerDevicePairingRoutes(app: OpenAPIHono<AuthedEnv>, db: DeviceDb = defaultDeviceDb): void {
  app.openapi(pairRoute, async (c) => {
    const pairing = await db.createPairing();
    return c.json(pairing, 201);
  });

  app.openapi(pollRoute, async (c) => {
    const { code } = c.req.valid('param');
    const result = await db.pollPairing(code);
    if (result.status === 'not_found') throw new ApiError(404, 'not_found', 'Not found');
    if (result.status === 'pending') return c.json({ status: 'pending' as const }, 200);
    return c.json(
      { status: 'claimed' as const, deviceId: result.deviceId, householdId: result.householdId, deviceSecret: result.deviceSecret },
      200,
    );
  });

  app.openapi(tokenRoute, async (c) => {
    const { deviceId, householdId, deviceSecret } = c.req.valid('json');
    const device = await db.verifyDeviceCredential(householdId, deviceId, deviceSecret);
    if (device === null) throw new ApiError(401, 'unauthorized', 'Unknown device or wrong secret');

    const agent = c.req.header('User-Agent') ?? null;
    await db.touchDeviceLastSeen(householdId, deviceId, agent === null ? null : agent.slice(0, 200));

    const token = await signDeviceToken({
      deviceId,
      householdId,
      exp: Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_SECONDS,
    });
    return c.json({ token, expiresIn: DEVICE_TOKEN_TTL_SECONDS }, 200);
  });
}

// --- device-authenticated: what a paired device reads about itself --------

const meRoute = createRoute({
  method: 'get',
  path: '/v1/devices/me',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ device: DeviceSchema, mode: ScheduleModeSchema }) } },
      description: "The device's own record, plus its schedule already evaluated for right now",
    },
    403: { description: 'Not a device credential' },
    404: { description: 'Device has been revoked' },
  },
});

const reportScreenRoute = createRoute({
  method: 'put',
  path: '/v1/devices/me/screen',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: ReportDeviceScreenSchema } } } },
  responses: {
    204: { description: 'Recorded' },
    403: { description: 'Not a device credential' },
    404: { description: 'Device has been revoked' },
  },
});

export function registerDeviceSelfRoutes(app: OpenAPIHono<AuthedEnv>, db: DeviceDb = defaultDeviceDb): void {
  app.openapi(meRoute, async (c) => {
    const principal = c.get('user');
    if (principal.kind !== 'device') {
      throw new ApiError(403, 'forbidden', 'This endpoint is for paired devices, not signed-in members');
    }
    const device = await db.loadDevice(principal.householdId, principal.deviceId);
    if (device === null) throw new ApiError(404, 'not_found', 'Not found');
    const mode = evaluateScheduleAt(device.schedule, new Date().toISOString());
    return c.json({ device, mode }, 200);
  });

  app.openapi(reportScreenRoute, async (c) => {
    const principal = c.get('user');
    if (principal.kind !== 'device') {
      throw new ApiError(403, 'forbidden', 'This endpoint is for paired devices, not signed-in members');
    }
    const { width, height } = c.req.valid('json');
    const updated = await db.updateDevice(principal.householdId, principal.deviceId, { screenWidth: width, screenHeight: height });
    if (updated === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });
}

// --- user-authenticated: managing a household's devices -------------------

const claimRoute = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/devices/claim',
  security: [{ Bearer: [] }],
  request: { params: hidParams, body: { content: { 'application/json': { schema: ClaimDeviceSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ device: DeviceSchema }) } }, description: 'Paired' },
    404: { description: 'Unknown, already-claimed, or expired code' },
  },
});

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/devices',
  security: [{ Bearer: [] }],
  request: { params: hidParams },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ devices: z.array(DeviceSchema) }) } }, description: "This household's paired devices" },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}/devices/{did}',
  security: [{ Bearer: [] }],
  request: { params: deviceParams, body: { content: { 'application/json': { schema: UpdateDeviceSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ device: DeviceSchema }) } }, description: 'Updated' },
    404: { description: 'Not found' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/devices/{did}',
  security: [{ Bearer: [] }],
  request: { params: deviceParams },
  responses: { 204: { description: 'Revoked' }, 404: { description: 'Not found' } },
});

export function registerDeviceManagementRoutes(app: OpenAPIHono<AuthedEnv>, db: DeviceDb = defaultDeviceDb): void {
  app.openapi(claimRoute, async (c) => {
    const { sub } = requireUser(c);
    const { hid } = c.req.valid('param');
    const { code, name } = c.req.valid('json');
    const result = await db.claimPairing({ code, householdId: hid, name, createdBy: sub });
    if (result === null) throw new ApiError(404, 'not_found', 'This code is no longer valid');
    // The secret is delivered to the device itself via the poll endpoint,
    // never to the claiming user's own session.
    return c.json({ device: result.device }, 201);
  });

  app.openapi(listRoute, async (c) => {
    requireUser(c);
    const { hid } = c.req.valid('param');
    return c.json({ devices: await db.listDevices(hid) }, 200);
  });

  app.openapi(patchRoute, async (c) => {
    requireUser(c);
    const { hid, did } = c.req.valid('param');
    const patch = c.req.valid('json');
    const device = await db.updateDevice(hid, did, patch);
    if (device === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ device }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    requireUser(c);
    const { hid, did } = c.req.valid('param');
    const deleted = await db.deleteDevice(hid, did);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });
}
