import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CalendarBoardConfigSchema, CalendarEventSchema, IdSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { loadBoard } from '../db/boards.js';
import { GoogleNotConnectedError, GoogleReauthRequiredError } from '../google/accessToken.js';
import { listBoardEvents } from '../google/service.js';

export interface CalendarDb {
  loadBoard: typeof loadBoard;
  listBoardEvents: typeof listBoardEvents;
}

export const defaultCalendarDb: CalendarDb = { loadBoard, listBoardEvents };

const params = z.object({ hid: IdSchema, bid: IdSchema });

const eventsRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards/{bid}/events',
  security: [{ Bearer: [] }],
  request: {
    params,
    query: z.object({ from: z.string(), to: z.string() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ events: z.array(CalendarEventSchema) }) } }, description: 'Merged, normalised events across the board\'s enabled calendars' },
    404: { description: 'Board not found or not a calendar board' },
    409: { description: 'Household has no connected Google account, or needs reconnecting' },
  },
});

/**
 * Device-eligible, like every other board type's read endpoint — a wall
 * dashboard showing the family calendar is the primary motivation for this
 * whole feature (FEATURE_ANALYSIS.md's Phase 2). No `requireUser()` here.
 */
export function registerCalendarRoutes(app: OpenAPIHono<AuthedEnv>, db: CalendarDb = defaultCalendarDb): void {
  app.openapi(eventsRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    const { from, to } = c.req.valid('query');

    const board = await db.loadBoard(hid, bid);
    if (board === null || board.type !== 'calendar') throw new ApiError(404, 'not_found', 'Not found');

    const config = CalendarBoardConfigSchema.parse(board.config);
    const calendarIds = config.calendars.filter((cal) => cal.enabled).map((cal) => cal.id);

    try {
      const events = await db.listBoardEvents(hid, calendarIds, { from, to });
      return c.json({ events }, 200);
    } catch (err) {
      if (err instanceof GoogleNotConnectedError || err instanceof GoogleReauthRequiredError) {
        throw new ApiError(409, 'google_not_ready', err.message);
      }
      throw err;
    }
  });
}
