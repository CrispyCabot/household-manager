import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  ClockSchema,
  IdSchema,
  MeResponseSchema,
  NotificationChannelSchema,
  PushTokenSchema,
  ThemeSchema,
  normalizeTextPhone,
} from '@hhm/shared';
import { type AuthedEnv, requireUser } from '../auth.js';
import { ApiError } from '../errors.js';
import { claimInvites } from '../db/invites.js';
import { listHouseholdsForUser } from '../db/households.js';
import {
  clearTextVerification,
  confirmTextPhone,
  countTextVerificationAttempt,
  getTextVerification,
  removeTextPhone,
  setClock,
  setLastHousehold,
  setNotifyVia,
  setTheme,
  startTextVerification,
  upsertProfile,
} from '../db/profiles.js';
import { removePushToken, savePushToken } from '../db/pushTokens.js';
import { sendText } from '../sms.js';

export interface MeDb {
  claimInvites: typeof claimInvites;
  listHouseholdsForUser: typeof listHouseholdsForUser;
  upsertProfile: typeof upsertProfile;
  setLastHousehold: typeof setLastHousehold;
  setTheme: typeof setTheme;
  setNotifyVia: typeof setNotifyVia;
  setClock: typeof setClock;
  savePushToken: typeof savePushToken;
  removePushToken: typeof removePushToken;
  getTextVerification: typeof getTextVerification;
  startTextVerification: typeof startTextVerification;
  countTextVerificationAttempt: typeof countTextVerificationAttempt;
  confirmTextPhone: typeof confirmTextPhone;
  clearTextVerification: typeof clearTextVerification;
  removeTextPhone: typeof removeTextPhone;
  sendText: typeof sendText;
}

export const defaultMeDb: MeDb = {
  claimInvites,
  listHouseholdsForUser,
  upsertProfile,
  setLastHousehold,
  setTheme,
  setNotifyVia,
  setClock,
  savePushToken,
  removePushToken,
  getTextVerification,
  startTextVerification,
  countTextVerificationAttempt,
  confirmTextPhone,
  clearTextVerification,
  removeTextPhone,
  sendText,
};

const TEXT_CODE_TTL_MS = 10 * 60 * 1000;
const TEXT_CODE_RESEND_MS = 30 * 1000;
const TEXT_CODE_MAX_ATTEMPTS = 5;

function hashTextCode(sub: string, code: string): string {
  return createHash('sha256').update(`${sub}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const getMeRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  security: [{ Bearer: [] }],
  responses: {
    200: { content: { 'application/json': { schema: MeResponseSchema } }, description: 'The caller, their households, and their last-visited one' },
  },
});

const putLastHouseholdRoute = createRoute({
  method: 'put',
  path: '/v1/me/last-household',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ householdId: IdSchema }) } } } },
  responses: { 204: { description: 'Remembered' } },
});

const putThemeRoute = createRoute({
  method: 'put',
  path: '/v1/me/theme',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ theme: ThemeSchema.nullable() }) } } } },
  responses: { 204: { description: 'Saved' } },
});

const putNotificationsRoute = createRoute({
  method: 'put',
  path: '/v1/me/notifications',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ via: NotificationChannelSchema }) } } } },
  responses: { 204: { description: 'Saved' } },
});

const putClockRoute = createRoute({
  method: 'put',
  path: '/v1/me/clock',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ clock: ClockSchema }) } } } },
  responses: { 204: { description: 'Saved' } },
});

const pushTokenBody = { content: { 'application/json': { schema: z.object({ token: PushTokenSchema }) } } };
const registerPushTokenBody = {
  content: { 'application/json': { schema: z.object({ token: PushTokenSchema, actionButtons: z.boolean().optional() }) } },
};

const putPushTokenRoute = createRoute({
  method: 'put',
  path: '/v1/me/push-token',
  security: [{ Bearer: [] }],
  request: { body: registerPushTokenBody },
  responses: { 204: { description: 'This phone now receives task reminders' } },
});

const deletePushTokenRoute = createRoute({
  method: 'delete',
  path: '/v1/me/push-token',
  security: [{ Bearer: [] }],
  request: { body: pushTokenBody },
  responses: { 204: { description: 'This phone no longer receives task reminders' } },
});

const putTextPhoneRoute = createRoute({
  method: 'put',
  path: '/v1/me/text-phone',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ phone: z.string().max(40) }) } } } },
  responses: { 204: { description: 'A verification code was texted to the number' } },
});

const verifyTextPhoneRoute = createRoute({
  method: 'post',
  path: '/v1/me/text-phone/verify',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ code: z.string().max(20) }) } } } },
  responses: { 204: { description: 'The number now gets task reminders by text' } },
});

const deleteTextPhoneRoute = createRoute({
  method: 'delete',
  path: '/v1/me/text-phone',
  security: [{ Bearer: [] }],
  responses: { 204: { description: 'No more reminders by text' } },
});

const deletePendingTextPhoneRoute = createRoute({
  method: 'delete',
  path: '/v1/me/text-phone/pending',
  security: [{ Bearer: [] }],
  responses: { 204: { description: 'The unverified number is dropped; a verified one stays' } },
});

export function registerMeRoutes(app: OpenAPIHono<AuthedEnv>, db: MeDb): void {
  app.openapi(getMeRoute, async (c) => {
    const { sub, email } = requireUser(c);
    // Must run before households are listed — otherwise an invite claimed
    // moments ago would not show up until the NEXT request.
    await db.claimInvites(sub, email);
    const profile = await db.upsertProfile(sub, email);
    const households = await db.listHouseholdsForUser(sub);
    return c.json(
      {
        sub,
        email: profile.email,
        lastHouseholdId: profile.lastHouseholdId,
        theme: profile.theme,
        notifyVia: profile.notifyVia,
        clock: profile.clock,
        textPhone: profile.textPhone,
        pendingTextPhone: profile.pendingTextPhone,
        households,
      },
      200,
    );
  });

  app.openapi(putLastHouseholdRoute, async (c) => {
    const { sub } = requireUser(c);
    const { householdId } = c.req.valid('json');
    await db.setLastHousehold(sub, householdId);
    return c.body(null, 204);
  });

  app.openapi(putThemeRoute, async (c) => {
    const { sub } = requireUser(c);
    const { theme } = c.req.valid('json');
    await db.setTheme(sub, theme);
    return c.body(null, 204);
  });

  app.openapi(putNotificationsRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.setNotifyVia(sub, c.req.valid('json').via);
    return c.body(null, 204);
  });

  app.openapi(putClockRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.setClock(sub, c.req.valid('json').clock);
    return c.body(null, 204);
  });

  app.openapi(putPushTokenRoute, async (c) => {
    const { sub } = requireUser(c);
    const { token, actionButtons } = c.req.valid('json');
    await db.savePushToken(sub, token, new Date().toISOString(), actionButtons ?? false);
    return c.body(null, 204);
  });

  app.openapi(deletePushTokenRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.removePushToken(sub, c.req.valid('json').token);
    return c.body(null, 204);
  });

  app.openapi(putTextPhoneRoute, async (c) => {
    const { sub } = requireUser(c);
    const phone = normalizeTextPhone(c.req.valid('json').phone);
    if (phone === null) throw new ApiError(400, 'invalid_phone', 'Enter a 10 digit US or Canadian phone number.');
    const now = new Date();
    const pending = await db.getTextVerification(sub, now.toISOString());
    if (pending !== null && now.getTime() - Date.parse(pending.sentAt) < TEXT_CODE_RESEND_MS) {
      throw new ApiError(429, 'too_soon', 'A code was just sent. Wait a few seconds before asking for another.');
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.startTextVerification(sub, {
      phone,
      codeHash: hashTextCode(sub, code),
      expiresAt: new Date(now.getTime() + TEXT_CODE_TTL_MS).toISOString(),
      sentAt: now.toISOString(),
      attempts: 0,
    });
    try {
      await db.sendText(phone, `Your household-manager code is ${code}. It expires in 10 minutes. Reply STOP to stop texts.`);
    } catch (err) {
      console.error('failed to send verification text', err);
      await db.clearTextVerification(sub);
      throw new ApiError(503, 'text_unavailable', "Couldn't send a text to that number. Text messages may not be set up yet.");
    }
    return c.body(null, 204);
  });

  app.openapi(verifyTextPhoneRoute, async (c) => {
    const { sub } = requireUser(c);
    const pending = await db.getTextVerification(sub, new Date().toISOString());
    if (pending === null) throw new ApiError(400, 'code_expired', 'That code has expired. Send a new one.');
    if (pending.attempts >= TEXT_CODE_MAX_ATTEMPTS) {
      throw new ApiError(429, 'too_many_attempts', 'Too many wrong codes. Send a new one.');
    }
    const code = c.req.valid('json').code.replace(/\D/g, '');
    if (!sameHash(hashTextCode(sub, code), pending.codeHash)) {
      await db.countTextVerificationAttempt(sub);
      throw new ApiError(400, 'wrong_code', "That code doesn't match.");
    }
    await db.confirmTextPhone(sub, pending.phone);
    return c.body(null, 204);
  });

  app.openapi(deleteTextPhoneRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.removeTextPhone(sub);
    return c.body(null, 204);
  });

  app.openapi(deletePendingTextPhoneRoute, async (c) => {
    const { sub } = requireUser(c);
    await db.clearTextVerification(sub);
    return c.body(null, 204);
  });
}
