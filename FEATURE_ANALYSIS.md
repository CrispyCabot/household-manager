# Feature analysis — wall dashboard, Google Calendar, task sync, custom layouts

Investigation and plan for four phases. Each phase ends in something that
works on its own; nothing here requires the phase after it to be useful.

Written 2026-08-28 against `main` at `fcefd7d`.

Related reading: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md) for what shipped
recently, and
[the design doc](docs/superpowers/specs/2026-08-16-household-manager-design.md)
— §5 (boards as the pluggable unit) and §6's "Google Calendar sync (not
built; kept open)" are the foundations phases 2 and 3 build on, and this
document deliberately does not re-decide what that section already settled.

---

## Current state, verified

Five facts about the codebase set the shape of everything below.

**There is no device concept.** Every authenticated request today resolves to
a Cognito user (`api/src/auth.ts` → `AuthedUser { sub, email }`), and
`AuthedEnv` types that assumption into every route. A screen on a wall is not
a person, and pretending it is one is what makes phase 1 hard.

**Sessions expire at 60 days.** `infrastructure/lib/constructs/auth.ts` sets
`refreshTokenValidity: Duration.days(60)`. The SPA renews silently
(`app/src/auth/oidc.ts`'s `automaticSilentRenew`), but once the refresh token
itself lapses the wall display drops to a sign-in button and stays there
until someone carries a keyboard to it. This is the single requirement most
at odds with the current system.

**Boards declare config they cannot store.** `BoardTypeDefinition` in
`packages/shared/src/boards.ts` has a `configSchema` field, but `BoardSchema`
in `packages/shared/src/schemas.ts` has no `config` property, `createBoard`
in `api/src/db/boards.ts` never writes one, and nothing reads one. All four
existing board types happen not to need per-board settings. A calendar board
is the first type that does, so phase 2 has to close this gap before it can
do anything else.

**The layout is mobile-first and caps at two columns.** `.cardgrid` in
`app/src/styles.css` is `minmax(0, 1fr)`, widening to
`repeat(2, minmax(0, 1fr))` at one breakpoint and no further. On a 24"
landscape panel viewed from across a room, that is two very wide columns of
small text. The dashboard needs a wide layout on day one even though the real
answer is phase 4.

**Drag-and-drop already exists.** `@dnd-kit/core` and `@dnd-kit/sortable` are
app dependencies, driving the reorder mode in `app/src/routes/Home.tsx`.
Phase 4 extends this rather than introducing a layout library.

---

## Phase 1 — a permanent screen in the house

**End state.** A monitor on the wall, powered on, showing your household's
home page. It got there by booting. No keyboard was involved, no one signed
in, and it will still be showing it in six months. You configure it — name,
sleep schedule, and later its layout — from your phone.

### The four problems

1. **Identity.** The screen needs credentials that never expire and that you
   can revoke without touching the device.
2. **Authorization.** Those credentials sit in a hallway. They must not be
   able to invite members, delete boards, or read the household's Google
   refresh token.
3. **Display power.** A web page cannot turn a monitor off. Anything the
   browser does is a black `<div>`; the backlight stays lit, which on a wall
   at 2am is not "asleep".
4. **Legibility.** See the two-column cap above.

### Data model

Two new item shapes in the existing single table, following the addressing
convention in `packages/shared/src/keys.ts`:

```
HH#<householdId>    DEVICE#<deviceId>     the device record
PAIR#<code>         META                  an unclaimed pairing code (TTL)
```

The device record:

```ts
{
  id, householdId,
  name,                           // "Kitchen wall"
  kind: 'dashboard',              // room for 'display-only' etc. later
  secretHash,                     // SHA-256 of the device secret; never the secret
  schedule: ScheduleRule[],       // see below
  layout: DashboardLayout | null, // phase 4; null = auto-flow
  lastSeenAt,                     // updated on token exchange
  lastSeenAgent,                  // "pi-agent/1.0" or "browser"
  createdBy, createdAt, updatedAt
}
```

The pairing record holds `{ code, pollToken, expiresAt, deviceSecret? }` —
`deviceSecret` is written only at the moment of claiming and is read exactly
once.

**Two prerequisites on the pairing record, both easy to get wrong:**

- **TTL is not enabled on the table.** `DataConstruct` in
  `infrastructure/lib/constructs/data.ts` declares no
  `timeToLiveAttribute`, so adding one is a small CDK change that has to
  land before this works at all.
- **TTL is not an expiry check.** DynamoDB deletes expired items on a
  best-effort basis, typically within 48 hours — not at the second they
  expire. So the handler must compare `expiresAt` itself and reject a stale
  pairing; TTL is only there to sweep up the rows afterwards. Treating TTL
  as the security boundary would leave a claimable code alive for up to two
  days.

New key helpers alongside the existing ones: `deviceSk(deviceId)`,
`pairPk(code)`, `DEVICE_SK_PREFIX`. `listBoards` filters board sub-items by
counting `#` segments; device items live under a different SK prefix
entirely, so nothing existing needs to change to accommodate them.

### Pairing flow

The Pi has no account and no browser session. It bootstraps like a smart TV.

1. The Pi's browser, on first load of `/dashboard` with no stored credential,
   calls `POST /v1/devices/pair` — **unauthenticated**. The API mints a short
   human-readable code (`H4K-92T`, unambiguous alphabet, no `O`/`0`), a
   random `pollToken`, and writes the pairing record. Returns
   `{ code, pollToken }`. The screen displays the code in very large type.
2. The browser polls `GET /v1/devices/pair/:pollToken` every 3 seconds — also
   unauthenticated, but the poll token is unguessable and short-lived.
3. On your phone, signed in as a member:
   `POST /v1/households/:hid/devices/claim { code, name }`. The API creates
   the device record under that household, generates a 32-byte device secret,
   stores only its hash, and attaches the plaintext to the pairing record.
4. The next poll returns `{ deviceId, householdId, deviceSecret }` and the
   pairing record is deleted immediately. This is the only time the secret is
   transmitted.
5. The browser writes the secret to `localStorage`; the Pi agent (below)
   reads it from there, or is handed it once during setup, and keeps its own
   copy at `/etc/household-dashboard/credentials`, mode `0600`.

Thereafter the device exchanges its secret for a short-lived JWT:
`POST /v1/devices/token { deviceId, deviceSecret }` → `{ token, expiresIn }`,
15 minutes, renewed on a timer. The secret never expires; you revoke a device
by deleting its record, and the next exchange fails.

**Rate limiting matters here.** `/v1/devices/token` and the pair endpoints are
the only unauthenticated write paths in the API besides `/actions/*`. Both
need a per-IP throttle at the HTTP API level, and the pairing code needs
enough entropy that guessing within its 10-minute window is hopeless
(7 characters from a 32-symbol alphabet is ~35 bits — ample).

### Authorization — the real refactor

Signing device tokens is easy; `api/src/actionToken.ts` already establishes
HMAC signing against a Secrets Manager secret, and the same secret (or a
sibling) serves here.

The work is that `api/src/auth.ts` currently types every request as having a
user. It becomes a **principal**:

```ts
type Principal =
  | { kind: 'user'; sub: string; email: string }
  | { kind: 'device'; deviceId: string; householdId: string };
```

`createAuthMiddleware` accepts either a Cognito ID token or a device JWT and
sets `principal`. `api/src/middleware/household.ts` gains a device branch: a
device belongs to exactly one household, and any `:hid` that is not that one
404s, exactly as a non-member user's does today.

Then every route needs an answer for devices. The proposed split:

| Device may | Device may not |
| --- | --- |
| Read boards, tasks, checklist, text, links, calendar | Create or delete boards |
| Complete, dismiss, and snooze tasks (it's a touchscreen) | Create or edit tasks |
| Check and uncheck checklist items | Invite or remove members |
| Read its own device record | Read or write other devices |
| — | Read the Google connection or its token |
| — | Rename or delete the household |

Two notes on that table. Completing a task from the wall records
`lastCompletedBy`, which today is a Cognito `sub` — it needs either to become
a display string or to gain a sibling `lastCompletedByLabel`, so the history
reads "Kitchen wall" rather than a dangling UUID. And the restriction to
*acting on* rather than *authoring* content is what keeps a stolen Pi boring:
it can tick off the bins, it cannot exfiltrate calendar credentials or add
itself a member.

Implementation shape: a `requireUser()` guard applied to the mutating routes,
so the default for a newly added route is the safe one — a device is rejected
unless that route opts it in.

**Concretely, this is a type change that reaches every route module.** Each
one is declared as `registerXRoutes(app: OpenAPIHono<AuthedEnv>, …)`, so
`AuthedEnv` becoming `PrincipalEnv` makes the compiler walk you through all
of them — which is the good version of this refactor. Follow the compiler,
and treat any route where the answer is not obvious as a design question
rather than a cast. New endpoints also need `createRoute` definitions like
the rest, since the OpenAPI document is generated from them.

### API surface

```
POST   /v1/devices/pair                        unauth  → { code, pollToken }
GET    /v1/devices/pair/:pollToken             unauth  → pending | claimed + secret
POST   /v1/devices/token                       unauth  → short-lived device JWT
GET    /v1/devices/me                          device  → own record: schedule, layout
POST   /v1/households/:hid/devices/claim       user    → claims a pairing code
GET    /v1/households/:hid/devices             user    → list
PATCH  /v1/households/:hid/devices/:deviceId   user    → name, schedule, layout
DELETE /v1/households/:hid/devices/:deviceId   user    → revoke
```

`GET /v1/devices/me` is what both enforcement layers poll, and it is
deliberately the device's *own* record only — a device cannot enumerate its
siblings.

### Schedule model

A weekly rule list, stored on the device record, evaluated in Eastern time
using `packages/shared/src/time.ts`. The DST-correctness work already done
for reminders applies unchanged here, and reusing it is the whole reason not
to invent a second time model.

```ts
type ScheduleRule = {
  days: number[];          // 0=Sun .. 6=Sat
  from: string;            // "HH:mm", Eastern wall clock
  to: string;              // "HH:mm"
  mode: 'on' | 'screensaver' | 'off';
};
```

Rules are evaluated in order, first match wins, no match means `on`. A window
crossing midnight (`22:00`–`06:30`) is normalised into two intervals at
evaluation time rather than stored as one — worth a unit test, alongside the
DST-transition cases `time.test.ts` already covers.

A realistic default, offered at claim time so a new device is useful
immediately:

```
Mon–Fri  06:30–22:00  on   |  22:00–06:30  off
Sat–Sun  07:30–23:00  on   |  23:00–07:30  off
```

**Touch overrides the schedule.** Tapping a sleeping screen wakes it for a
grace period (default 15 minutes), then it returns to whatever the schedule
says. Without this, an `off` window makes the display useless exactly when
you walk past it at 11pm — which is when a household dashboard is handy.

### Two-layer enforcement

This is the part people get wrong. A browser cannot power a display down, so
the schedule is enforced twice, from one source of truth.

**Layer 1 — in the page.** The dashboard SPA polls `GET /v1/devices/me`,
evaluates the schedule locally every 30 seconds, and renders:

- `on` — the normal dashboard.
- `screensaver` — a full-bleed dimmed clock, tomorrow's weather or the day's
  agenda; low light output, still glanceable at night.
- `off` — a pure black full-screen layer. On its own this is *not* the screen
  being off; it is the fallback for when layer 2 is unavailable.

**Layer 2 — on the Pi.** A small Python or shell agent, run by a systemd
timer every 60 seconds, polls the same endpoint with the same credential and
drives the actual panel:

```sh
# Wayland (Raspberry Pi OS Bookworm — labwc on Pi 5, Wayfire on Pi 4)
wlr-randr --output HDMI-A-1 --off
wlr-randr --output HDMI-A-1 --on

# older X11 sessions
xset dpms force off
xset dpms force on

# Pi 4 and earlier, if wlr-randr is unavailable
vcgencmd display_power 0
vcgencmd display_power 1
```

The monitor drops to DPMS standby: backlight genuinely off, panel dark,
drawing about a watt. That is the ceiling for a touchscreen monitor — see the
CEC note under hardware.

Both layers read one schedule from one endpoint, so editing it on your phone
converges everywhere within a minute, and losing the agent degrades to a
black screen rather than a broken one.

### The wall breakpoint

A stopgap, ~30 lines of CSS, that phase 4 later supersedes. Add a
`@media (min-width: 1200px)` tier taking `.cardgrid` to 3–4 columns, and a
`.dashboard` body class that scales the type ramp up (roughly 1.4×) for a
2–3 metre viewing distance. Without it, phase 1 ships something that
technically works and visibly looks wrong, which tends to stall a project
right at the point it should feel rewarding.

### App changes

- **`/dashboard` route** — a distinct shell from `Home`, not the same page
  with a flag. It renders the pairing screen when no device credential
  exists, and otherwise the board grid with `AlertBanner`, no `Masthead`
  chrome, no household switcher, and no settings affordances.
- **`DeviceAuthProvider`** — parallel to `AuthProvider`, holding a device
  credential rather than an OIDC user, exchanging the secret for a JWT and
  renewing on a timer. `app/src/api/client.ts` takes its bearer token from
  whichever provider is active.
- **Settings → Devices** — a list under `app/src/routes/SettingsPage.tsx`,
  with a per-device page: name, schedule editor, screensaver choice, last
  seen, revoke, and (phase 4) the layout editor.
- **Kiosk resilience**, all small but each one is a failure mode that
  otherwise needs a ladder:
  - React Query `refetchInterval` on the dashboard, since nobody will pull to
    refresh it.
  - Offline banner rather than an error boundary — the Wi-Fi will drop.
  - A **scheduled 4am reload**. A Chromium tab open continuously for weeks
    accumulates memory; a nightly reload during an `off` window costs nothing
    and prevents the slow degradation that otherwise shows up as "the screen
    got sluggish after a month".
  - Wake on `pointerdown` anywhere while sleeping, feeding the touch
    override.

### What to buy

**Recommended: a 21.5"–24" capacitive touchscreen monitor**, HDMI in, USB-B
for touch, VESA 100×100. Roughly £150–£300.

What to check before ordering, in order of how often it bites:

- **Capacitive, 10-point, USB-HID compliant.** Plenty of budget "touch
  monitors" are resistive single-touch, or ship a Windows-only driver. HID
  multitouch works on Raspberry Pi OS with no driver at all; anything else
  may never work. If the listing does not say "driver-free" or "HID", assume
  it is not.
- **VESA mount.** Many consumer monitors omit it, and a stand on a wall is
  not a plan.
- **Matte finish** if it faces a window.
- **Power draw and cable exit.** Right-angle HDMI and USB cables, so the
  panel sits close to the wall.

**The tradeoff you are accepting.** Touchscreen monitors essentially never
support HDMI-CEC. CEC is what would let the Pi genuinely power a *TV* on and
off — a real power state, not a dark backlight. With a monitor, `off` means
DPMS standby: dark, about a watt, and the power LED usually still glows. If a
truly-off display matters more than touch, buy a small TV instead, install
`cec-utils`, and have the agent call `echo "standby 0" | cec-client -s -d 1`
and `echo "on 0" | cec-client -s -d 1` — everything else in this phase is
unchanged. You chose touch, so the plan targets DPMS, and the agent is
written with a pluggable "display driver" so swapping in CEC later is one
file.

**Also needed:** the Raspberry Pi you have (4 or 5 both fine — a dashboard is
not demanding), its official PSU (undervoltage is the most common cause of
mystery Pi instability), a good-quality A2 microSD or a USB SSD, a VESA
mount, and a short right-angle HDMI plus a USB-A-to-B cable for touch.

### Setting up the Pi

Implemented as a full start-to-finish walkthrough in
[`pi-agent/README.md`](pi-agent/README.md) — blank SD card through a paired,
scheduled wall display, written for a first-time (or first-time-in-a-while)
setup: flashing Raspberry Pi OS, first boot, killing every screen-blanking
path, launching Chromium in kiosk mode via a systemd user service, hiding the
cursor, protecting the SD card with an overlay filesystem, installing
`dashboard_agent.py` (stdlib-only Python; polls `GET /v1/devices/me` every 60
seconds, drives the display only on schedule-mode *transitions*, tries
`wlr-randr` → `xset` → `vcgencmd` in order, and runs a loopback-only HTTP
listener the dashboard page hands its device credential to right after
pairing — see that file's "Why a separate credential file" for why that
hand-off exists at all), and pairing the display itself. Kept there rather
than duplicated here so the two don't drift out of sync.

**8. Nice to have.** `unattended-upgrades` for security patches, and Tailscale
or similar if you want to reach the Pi remotely without port-forwarding.

### Risks

- **The authorization refactor touches every route.** It is the largest
  single change in this document, and it is unavoidable — this is the price
  of a device that is not a user. Budget for it honestly rather than
  discovering it midway.
- **Wayland display control varies by Pi model and OS release.** `wlr-randr`,
  `wlopm`, and `vcgencmd` each work on some combinations. Determine which
  works on your actual Pi *before* writing the agent, and have it fall back
  through the list rather than assuming.
- **A stolen or resold Pi keeps a valid credential** until revoked. The
  read-mostly authorization model is the mitigation; the device list showing
  `lastSeenAt` is how you notice.

### Done when

The Pi boots with no input attached and lands on your household home page;
the screen backlight goes off and on according to a schedule you edited from
your phone; tapping it wakes it; you can revoke it from Settings and watch it
fall back to a pairing code.

---

## Phase 2 — a Google Calendar board

**End state.** A board type whose card shows the next few events and whose
page shows an agenda, week, or month view across several Google calendars —
each with its own colour — and which is still working, unattended, a year
from now.

### First, close the board-config gap

Nothing in phase 2 works until a board can store settings.

- Add `config: z.record(z.unknown()).default({})` to `BoardSchema`.
- Persist it in `createBoard` and return it from `fromItem`
  (`api/src/db/boards.ts`).
- Add `PATCH /v1/households/:hid/boards/:bid/config`, validating the body
  against `boardType(board.type).configSchema` — the field the registry has
  declared since day one and nothing has ever used.
- Existing boards read back `{}`, so this is additive with no migration.

This is genuinely small, and it is the thing that keeps the calendar board a
plugin rather than a special case.

### The Google connection

One connection per household, held at:

```
HH#<householdId>    GOOGLE#connection
```

```ts
{
  googleAccountEmail,      // shown in settings: "connected as ..."
  secretArn,               // Secrets Manager, holds the refresh token
  scopes,
  status: 'connected' | 'needs_reauth',
  connectedBy, connectedAt, lastRefreshedAt
}
```

The refresh token lives in Secrets Manager, never in the table and never in
any API response — matching what §6 of the design doc already specified. One
secret per household, about $0.40/month.

**OAuth flow:**

1. `GET /v1/households/:hid/google/auth-url` (member only) returns Google's
   consent URL with `access_type=offline`, `prompt=consent`, and a `state`
   signed with the existing HMAC secret carrying the household ID.
2. `GET /v1/google/callback` — unauthenticated by necessity, since Google
   redirects there; the signed `state` is what authenticates it. Exchanges
   the code, writes the refresh token to Secrets Manager, writes the
   connection record, redirects back into the app.
3. `DELETE /v1/households/:hid/google` disconnects and deletes the secret.

**Request both `calendar.events` and `calendar.readonly` from the start.**
Neither one alone is enough: `calendar.events` covers reading/writing
events but Google rejects `calendarList.list` under it with
`ACCESS_TOKEN_SCOPE_INSUFFICIENT` — listing which calendars exist is a
separate permission from reading/writing events on them, and the calendar
picker (§7) needs it. `calendar.readonly` supplies that, plus redundant
(harmless) read access to events. Requesting `calendar.events` for write
access from the start is still the right call for Phase 3's sake — it's
just not sufficient on its own, which the first real test of this connection
caught (a 403 on `/google/calendars`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`).

### The gotcha that would break "permanently signed in"

**An OAuth app left in "Testing" publishing status has refresh tokens that
expire after 7 days.** Not the access token — the refresh token. Your
dashboard would work for a week and then demand a re-login, which is exactly
the failure mode this whole feature exists to avoid, and it looks like a bug
in your code rather than a console setting.

The fix is a checkbox: in Google Cloud Console → APIs & Services → OAuth
consent screen, **Publish app** to move it to "In production".

Consequences, so none of them surprise you:

- Calendar scopes are classed **sensitive**, so an External unverified app in
  production shows a "Google hasn't verified this app" interstitial at
  consent. You click Advanced → "Go to … (unsafe)" once, ever. Verification
  is only worth pursuing if you distribute this beyond your household.
- Unverified published apps are capped at 100 granted users. Irrelevant here.
- A refresh token unused for six months is revoked. Also irrelevant — the
  dashboard polls daily.
- The token is revoked if you remove the app from your Google account's
  security settings, or in some cases on password change. Hence
  `status: 'needs_reauth'` on the connection record and a visible banner
  rather than a silent empty calendar.

**Console setup, once:** create a project, enable the Google Calendar API,
configure the OAuth consent screen (External, your email as support and
developer contact, both the `calendar.events` and `calendar.readonly`
scopes — added under the consent screen's Data Access/Scopes section; a
scope the app requests at runtime but that isn't listed there gets rejected
or silently dropped by Google), create an OAuth client ID of
type "Web application" with the redirect URI
`https://api.household-manager.chrisbridewell.dev/v1/google/callback`, then
publish. Put the client ID and secret in Secrets Manager and reference them
from the API Lambda's environment.

### The API proxies Google

The browser never talks to Google directly. This matters for a reason
specific to phase 1: **the wall display has no Google identity**. If tokens
lived in the browser, the dashboard could not render a calendar at all. Every
call goes through the API, which holds the household's token and answers any
principal — user or device — that is allowed to read the board.

```
GET /v1/households/:hid/google/calendars              → calendarList.list, for the picker
GET /v1/households/:hid/boards/:bid/events?from&to    → merged, normalised events
```

The events endpoint refreshes the access token (cached in Lambda container
memory for its ~1 hour life, so most invocations skip the round trip), calls
`events.list` per enabled calendar with `singleEvents=true` and
`orderBy=startTime` so recurring events arrive already expanded, merges,
sorts, and returns a normalised shape that does not leak Google's payload
into the client:

```ts
{ id, calendarId, title, start, end, allDay, location, description }
```

Free-tier quota is a million queries a day. Not a constraint.

### Board config and UI

```ts
{
  calendars: [{ id, colour, enabled }],
  defaultView: 'agenda' | 'week' | 'month',
  daysAhead: number      // what the card previews
}
```

A new `app/src/boards/calendar/` folder — `index.tsx` registering
`{ Card, Page }`, a `Card` showing the next few events, a `Page` with the
three views, and a config panel for picking calendars and colours. Plus the
mirrored `packages/shared/src/boards/calendar/` for schemas, and
`api/src/boards/`-side routes. This follows `boards/tasks/` exactly; the
registry means no core file changes beyond the config gap above.

For the wall display, the agenda view is the one that matters — a month grid
at 3 metres is unreadable. Worth designing the agenda view first.

### Risks

- **Read-only until phase 3, but with write scope granted.** Slightly more
  access than strictly needed for one phase, in exchange for never
  re-consenting. Deliberate.
- **A household-level connection means everyone sees those calendars.** That
  is the point for a shared wall display, and it is worth being explicit
  about in the connect screen so nobody links a work account by accident.
- **Timezone handling.** Google returns events with their own timezones;
  all-day events are dates, not instants. Normalise on the server, reusing
  the Eastern conventions in `packages/shared/src/time.ts`, rather than
  letting each view improvise.

### Done when

You add a Calendar board, connect a Google account once, pick two calendars,
and see the family calendar on the wall — and it is still there next month
without anyone signing in again.

---

## Phase 3 — tasks into Google Calendar

**End state.** A task board can mirror its tasks into a Google calendar, so
the bins turning up on Thursday appears alongside everything else, on any
device that shows Google Calendar.

§6 of the design doc already settled the hard parts. This phase implements
them.

### Occurrences, not recurring events

A task with `anchor: 'completion'` has no expressible RRULE — its next date
is unknown until it is completed. So a task syncs as **one non-recurring
event for its current `dueAt`**. On completion, the next occurrence's event is
written. This falls out of the existing one-record-with-a-moving-`dueAt`
model for free, and applies uniformly to both anchors; treating
`anchor: 'schedule'` tasks as genuine recurring events is a possible later
optimisation and not worth special-casing now.

### Opt-in

Board-level with a per-task override:

- Tasks board config gains
  `googleSync: { enabled: boolean, calendarId: string | null }`.
- `TaskSchema` gains `syncToCalendar: boolean | null` — `null` inherits the
  board.
- `TaskSchema` gains `googleEventId` and `googleCalendarId`, both nullable,
  exactly as §6 anticipated.

### The write seam

Every date change already funnels through create / update / complete /
snooze / reschedule in `api/src/db/tasks.ts`. Sync hangs off that as an
adapter, the same shape as the `notify(user, alerts)` seam in §8. One place
to call it, one place to test it.

Event mapping:

- `summary` ← task title.
- `description` ← task description plus a deep link back to the board.
- All-day event on `dueAt`'s Eastern date; if `notifyTimeOfDay` is set, a
  30-minute timed event at that time instead.
- `extendedProperties.private` ← `{ hhmTaskId, hhmBoardId, hhmHouseholdId }`,
  which is what makes orphan detection possible later.
- Use a **client-specified event ID** derived deterministically from the task
  ID and occurrence, so a retried create is idempotent rather than producing
  duplicates. This is the single detail that most reliably prevents the
  "why are there four bin days" bug.

Lifecycle: completing a recurring task deletes or ticks the current event and
creates the next; completing a one-off deletes it; dismissing or deleting a
task deletes it; disabling sync removes the events it created.

### Failure policy

**A sync failure must never fail a task write.** Google being slow or
rate-limiting cannot be allowed to stop you ticking off a chore.

So: best-effort inline, plus `syncState: 'ok' | 'pending' | 'error'` and
`syncError` on the task, plus a reconciliation sweep that retries anything
pending or errored. The sweep rides on the **existing hourly EventBridge rule
in `infrastructure/lib/constructs/reminder.ts`** — no new schedule, no new
Lambda. A small "sync out of date" indicator on the task card is what makes a
persistent failure visible instead of mysterious.

### Explicitly deferred: inbound sync

Dragging an event in Google does *not* move the due date here. Doing it needs
either a watch channel with a public callback (push, complex, channels expire
and need renewal) or incremental polling with a stored `syncToken` (simpler,
delayed, and needs conflict rules for "both sides changed"). Outbound alone
is the valuable 80%, and the direction question deserves its own decision
once you have lived with outbound for a while.

### Done when

Ticking a task on the wall display makes the event disappear from Google
Calendar on your phone, and the next occurrence appears on its new date.

---

## Phase 4 — dashboard layout

**End state.** Each dashboard device has its own arrangement: the calendar
large on the left, tasks tall down the right, the shopping list a small tile.
Drag, resize, save. Your phone keeps the layout it has today.

Design it in phase 1 even though you build it here — the device record is
where the layout lives, so phase 1 should ship with the `layout` field
present and `null`.

### Model

A 12-column grid, not free pixel positioning. Grid positions snap, serialise
cleanly, survive a resolution change, and cannot produce overlapping or
off-screen boards.

```ts
type DashboardLayout = {
  columns: number;                                    // 12
  items: { boardId: string; x: number; y: number; w: number; h: number }[];
};
```

Stored on the device record, edited via the existing
`PATCH /v1/households/:hid/devices/:deviceId`, read by the device through
`GET /v1/devices/me`. No new endpoints.

**Boards absent from `items` simply do not appear.** A dashboard is a curated
view, not an obligation to show everything — this is a feature, since the wall
should show the calendar and the chores, not the archive of takeaway menus.

**Fallback:** `layout: null` auto-flows into the phase 1 wall breakpoint, so a
newly paired device looks reasonable before you have arranged anything.

### The editor

Extend the existing `@dnd-kit` setup: drag to move, corner handles to resize,
snapping to the grid, and a palette of unplaced boards to drag in.

**Edit it from your phone, against a scaled preview of the target device.**
Rendering the device's aspect ratio as a miniature canvas and manipulating
that is both easier to build and far better to use than standing on a chair
dragging tiles around a 24" panel. The wall then picks up the change on its
next poll — which also gives you an unusually satisfying feedback loop while
designing it.

### The one core change this forces

Board cards must become size-aware. `BoardTypeUi` in
`app/src/boards/registry.tsx` gains a size or density prop:

```ts
Card: ComponentType<{ board: Board; size?: { w: number; h: number } }>
```

A 1×1 tile shows a title and a count; a 4×3 tile shows a real preview. Every
board type gets a pass to use it — small individually, but it is four
components, and it is the reason this is phase 4 rather than a footnote to
phase 1.

### Done when

You rearrange the kitchen display from the sofa, and the wall updates itself
within a minute.

---

## Cross-cutting notes

**Sequencing.** 1 → 2 → 4 is the natural order if you want the wall to feel
finished; 1 → 2 → 3 → 4 if the calendar sync matters more than the polish.
Phase 2 does not depend on phase 1 at all and could be built first if you
want a visible win before tackling the authorization refactor — the calendar
board works fine on a phone.

**Testing.** `packages/shared` has vitest (added in the 2026-08-24 work); the
API does not have a test runner. Three areas here genuinely need automated
coverage rather than manual checks, and two of them live in `api/`:

- Schedule evaluation — midnight-crossing windows and DST transitions, in
  `packages/shared`, alongside the existing `time.test.ts`.
- The principal/authorization split — a table-driven test asserting that a
  device principal is rejected from every mutating route. This is the test
  that stops a future route from accidentally being device-writable.
- Task-to-event mapping and the idempotent event ID.

Standing up vitest in `api/` is a prerequisite for the last two, and worth
doing as the first commit of phase 1.

**Running cost.** Essentially unchanged. One extra Secrets Manager secret per
household (~$0.40/month), a handful of DynamoDB items, no new Lambdas — the
reconciliation sweep reuses the reminder rule, and the device polling is
well inside the free tier. The hardware is the only real spend.

**Deployment.** This repo deploys from CI on push to `main`; none of the above
needs a hand-run `cdk deploy`. The Google OAuth console setup in phase 2 and
the Pi provisioning in phase 1 are the only genuinely manual steps, and both
are one-time.

**What is not here.** Inbound calendar sync, per-user Google accounts,
multiple households on one display, and voice or motion wake. Each is a
reasonable follow-up; none is needed for the four phases to be worth having.
