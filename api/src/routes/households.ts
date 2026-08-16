import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CreateHouseholdSchema, HouseholdSchema, IdSchema, UpdateHouseholdSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import {
  VersionConflictError,
  createHousehold,
  deleteHousehold,
  listHouseholdsForUser,
  loadHousehold,
  renameHousehold,
} from '../db/households.js';

export interface HouseholdDb {
  createHousehold: typeof createHousehold;
  listHouseholdsForUser: typeof listHouseholdsForUser;
  loadHousehold: typeof loadHousehold;
  renameHousehold: typeof renameHousehold;
  deleteHousehold: typeof deleteHousehold;
}

export const defaultHouseholdDb: HouseholdDb = {
  createHousehold,
  listHouseholdsForUser,
  loadHousehold,
  renameHousehold,
  deleteHousehold,
};

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households',
  security: [{ Bearer: [] }],
  responses: {
    200: { content: { 'application/json': { schema: z.object({ households: z.array(HouseholdSchema) }) } }, description: 'Households the caller belongs to' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: CreateHouseholdSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ household: HouseholdSchema }) } }, description: 'Created' },
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ household: HouseholdSchema }) } }, description: 'OK' },
    404: { description: 'Not found' },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema }),
    body: { content: { 'application/json': { schema: UpdateHouseholdSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ household: HouseholdSchema }) } }, description: 'Updated' },
    409: { description: 'Version conflict' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: { 204: { description: 'Deleted' }, 403: { description: 'Only the creator may delete a household' } },
});

export function registerHouseholdRoutes(app: OpenAPIHono<AuthedEnv>, db: HouseholdDb): void {
  app.openapi(listRoute, async (c) => {
    const { sub } = c.get('user');
    const summaries = await db.listHouseholdsForUser(sub);
    const full = await Promise.all(summaries.map((h) => db.loadHousehold(h.id)));
    return c.json({ households: full.filter((h): h is NonNullable<typeof h> => h !== null) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { sub, email } = c.get('user');
    const body = c.req.valid('json');
    const household = await db.createHousehold({ creatorSub: sub, creatorEmail: email, name: body.name });
    return c.json({ household }, 201);
  });

  app.openapi(getRoute, async (c) => {
    const { hid } = c.req.valid('param');
    const household = await db.loadHousehold(hid);
    if (household === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ household }, 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { hid } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      const household = await db.renameHousehold(hid, body.name, body.version);
      return c.json({ household }, 200);
    } catch (err) {
      if (err instanceof VersionConflictError) throw new ApiError(409, 'version_conflict', err.message);
      throw err;
    }
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid } = c.req.valid('param');
    const { sub } = c.get('user');
    const household = await db.loadHousehold(hid);
    if (household === null) throw new ApiError(404, 'not_found', 'Not found');
    // The one asymmetry in an otherwise equal-rights household — spec's
    // Non-goals section.
    if (household.createdBy !== sub) {
      throw new ApiError(403, 'forbidden', 'Only the creator may delete this household');
    }
    await db.deleteHousehold(hid);
    return c.body(null, 204);
  });
}
