# household-manager — design

**Date:** 2026-08-16
**Status:** approved, ready for planning

Shared household management for the people who live in one. The first release
covers accounts, households, sharing, and a single feature — recurring tasks
that nag until they are done.

## Goals

- **API first.** The HTTP API is the product. The web app is its first client;
  native iOS/Android clients must be able to build against the same contract
  without server changes.
- **Mobile first.** The web UI is designed for a phone held one-handed and
  scales up, not down.
- **Generic core.** Nothing about "tasks" belongs in the household core. Adding
  a shopping list later must not require touching household code.
- **Cheap.** Serverless throughout, on-demand billing, no idle cost.

## Non-goals

- A permissions model. A household is shared with someone or it is not; members
  have equal rights. The single exception is deletion, which only the creator
  may do.
- Google Calendar sync — not built now, but a likely next feature, so the task
  model deliberately does not preclude it and the intended implementation is
  recorded in §6.
- Native mobile apps. The API is shaped to support them; they are not built.
- Tests. `PRACTICES.md` says none unless explicitly requested. See
  [Verification](#verification).

---

## 1. Conventions inherited

From `chrisbridewell-infrastructure/PRACTICES.md`:

- Deployment is CDK, in the app's `infrastructure/` directory, run from GitHub
  Actions.
- Every resource carries an `environment` tag (`prd` here — this app has only
  one environment) and a `project` tag (`household-manager`, identical across
  every resource).
- Reuse the existing Cognito user pool. Do not create another one.
- No test cases unless explicitly asked for.

Poster Walls Editor is the reference implementation for repo shape, the
two-phase custom-domain switch, and the deploy workflow. This project mirrors it
deliberately so the two stay legible as a pair.

---

## 2. Phase 0 — relocate the Cognito user pool to CoreInfra

Prerequisite work in the `chrisbridewell-infrastructure` repo. It does not block
household-manager technically — a pool's ID is stable across an import, so an
app client created against `us-east-1_1w3Dv2paU` behaves identically before and
after — but it is being done first by choice, to establish shared auth as a core
concern before a second app depends on it.

### Current state (verified 2026-08-16)

| Resource                       | Logical ID                     | DeletionPolicy |
| ------------------------------ | ------------------------------ | -------------- |
| `AWS::Cognito::UserPool`       | `AuthUserPool8115E87F`         | **Retain**     |
| `AWS::Cognito::UserPoolClient` | `AuthUserPoolWebClient147E4E38`| **None**       |
| `AWS::Cognito::UserPoolDomain` | `AuthUserPoolDomain31C6792A`   | **None**       |

Pool ID `us-east-1_1w3Dv2paU`, owned by the `PosterWalls` stack.

### Two constraints that force the order

1. **The client and domain are not retained.** Removing `AuthConstruct` from
   PosterWalls today would *delete the live app client*, breaking login
   permanently. Their removal policies must be flipped to `RETAIN` in a deploy
   of their own, first.
2. **The domain cannot be imported.** CloudFormation resource import requires
   `read` and `list` handlers in the registry schema.
   `AWS::Cognito::UserPool` and `AWS::Cognito::UserPoolClient` have both.
   `AWS::Cognito::UserPoolDomain` has **no `list` handler**, so it must be
   deleted and recreated. A pool holds exactly one domain, so the old one must
   be gone before the new one exists — and login is down in that gap.

### Sequence

| # | Repo      | Action                                                                                       | Outage |
| - | --------- | -------------------------------------------------------------------------------------------- | ------ |
| 1 | PosterWalls | `applyRemovalPolicy(RETAIN)` on the underlying `CfnUserPoolClient` and `CfnUserPoolDomain`. Deploy. Metadata only. | none |
| 2 | PosterWalls | Delete `AuthConstruct`. Source pool ID / client ID / hosted domain from SSM instead. Deploy — resources orphaned but alive. | none |
| 3 | CoreInfra   | Declare pool + PosterWalls client matching current config exactly; adopt via `cdk import`.   | none |
| 4 | CoreInfra   | Delete the orphaned domain; create it under CoreInfra with a **neutral prefix**. Then redeploy the PosterWalls SPA against the new domain. | **yes** |

Step 3 must reproduce the existing pool configuration precisely — self-signup
on, email sign-in alias, email auto-verify, 12-character password policy with
digit/lower/upper required, email-only account recovery, `RemovalPolicy.RETAIN`.
A mismatch is a silent config change to live auth, not a deploy error.

Step 4 forces a domain recreate regardless, so the new prefix should be neutral
(`chrisbridewell-<stack-uuid-suffix>`, derived the same way Poster Walls derives
its suffix — from the stack UUID, never the account ID, because the prefix ends
up in a public login URL). This incidentally retires the `poster-walls-…` login
URL that every app currently shares.

### The contract CoreInfra publishes

SSM parameters, read by every consuming app:

- `/core/auth/user-pool-id`
- `/core/auth/hosted-domain`

Apps read these at deploy time. No app declares a user pool; each declares only
its own app client.

---

## 3. Repository layout

npm workspaces, Node 24, ESM, TypeScript 5.9 with `strict` and
`exactOptionalPropertyTypes`.

```
api/                 Hono app, Lambda handler, local dev server
app/                 React 19 + Vite SPA
packages/shared/     Zod schemas, derived types, DynamoDB key helpers
infrastructure/      CDK: bootstrap stack + main stack
docs/superpowers/    specs and plans
.github/workflows/   ci.yml, deploy.yml
```

`packages/shared` is what makes "API first" real rather than aspirational: each
endpoint's request and response schema is declared once in Zod, then used three
ways — runtime validation in Hono, static types in React, and a generated
OpenAPI document for clients that are not written in TypeScript.

---

## 4. Data model

One DynamoDB table (`TableV2`, on-demand, PITR on, `RemovalPolicy.RETAIN`),
partition key `PK`, sort key `SK`, plus one sparse GSI.

| Item                 | PK                | SK                              | Notes                                   |
| -------------------- | ----------------- | ------------------------------- | --------------------------------------- |
| Household            | `HH#<hid>`        | `META`                          | name, createdBy, createdAt, version     |
| Board                | `HH#<hid>`        | `BOARD#<bid>`                   | type, title, config, position           |
| Task                 | `HH#<hid>`        | `BOARD#<bid>#TASK#<tid>`        | see §6                                  |
| Completion record    | `HH#<hid>`        | `BOARD#<bid>#TASK#<tid>#DONE#<ts>` | history; who completed it, when       |
| Member               | `HH#<hid>`        | `MEMBER#<sub>`                  | lists a household's people              |
| Membership           | `USER#<sub>`      | `HH#<hid>`                      | powers the switcher; household name denormalised |
| Profile              | `USER#<sub>`      | `PROFILE`                       | email (lowercased), lastHouseholdId     |
| Invite (by invitee)  | `INVITE#<email>`  | `HH#<hid>`                      | claimed at login                        |
| Invite (by household)| `HH#<hid>`        | `INVITE#<email>`                | lists a household's pending invites     |

Everything a household page needs — boards, tasks, members — sits in the
`HH#<hid>` partition, so rendering the dashboard is a single `Query`. Household
data is small by nature (one family's chores), so co-locating tasks with boards
is the right trade; it also means a task and its board can be written in one
transaction.

**Paired items are written transactionally.** Member + membership, and both
invite directions, are each a `TransactWriteCommand`. A household that exists
but does not appear in its creator's switcher is not a state the system can
reach.

### GSI1 — the reminder queue

```
GSI1PK = "DUE"
GSI1SK = <notifyAfter, ISO 8601>
```

**Sparse on purpose.** A task carries these two attributes only when it is
notifiable: due (or within its lead time), not complete, and not dismissed. The
scheduler therefore queries `GSI1PK = "DUE" AND GSI1SK <= now` and gets exactly
the work to do — completed and dismissed tasks are physically absent from the
index rather than filtered out of it.

Writing or stripping those two attributes *is* the notification state machine.
There is no separate reminder table and no per-task scheduled job.

A single `DUE` partition is a deliberate simplification at this scale. If the
write rate ever justifies it, shard to `DUE#<0-9>` and fan the query out; this
is the one place in the model that would need revisiting under load.

---

## 5. Boards — the pluggable unit

A household owns **boards**. Each board has a `type`. The household core knows
nothing about what any type does.

**Shared registry** (`packages/shared`): each board type declares its id,
display name, icon, and a Zod schema for its per-board config.

**API:** generic CRUD at `/v1/households/:hid/boards`. Type-specific routes
mount beneath it — `/v1/households/:hid/boards/:bid/tasks`. The generic layer
validates that the board exists, belongs to the household, and is of the
expected type; the type-specific router handles everything past that.

**Web:** a parallel registry maps `type → { Card, Page }`. The dashboard renders
`registry[board.type].Card` for each board and knows nothing else about it. Each
card fetches its own summary from its own endpoint, so adding a board type never
widens a core response.

Adding "shopping list" later is one folder in `api/src/boards/`, one in
`app/src/boards/`, and one registry entry in each. No core file changes.

---

## 6. Tasks

A task behaves like a calendar event that keeps nagging.

```ts
{
  id, householdId, boardId,
  title, description,
  dueAt,                                    // ISO 8601
  recurrence: { every, unit, anchor } | null,  // unit: day|week|month|year
  leadTimeDays,                             // start nagging this early
  notify: { inApp, email },
  assigneeIds,                              // optional, informational
  status: 'active' | 'completed',
  snoozedUntil, dismissed,
  notifyAfter,                              // mirrored into GSI1SK; absent = not notifiable
  lastCompletedAt, lastCompletedBy,
  createdBy, createdAt, updatedAt, version
}
```

### Recurrence anchor

`anchor: 'completion'` reschedules from the day the task was finished. Clean the
dog every 3 months, done on 8/10 → next due 11/10, exactly as specified.

`anchor: 'schedule'` reschedules from the previous *due* date, so a
calendar-anchored obligation does not drift when it is handled late. Rent due on
the 1st, paid on the 5th, is still due on the 1st next month.

Month and year arithmetic clamps to the end of the month: due 1/31 with a
one-month interval lands on 2/28 (2/29 in a leap year), and the following
occurrence is computed from that clamped date.

### Lifecycle

A recurring task is **one record**, not a chain of new ones. Completing it
appends a completion record and moves `dueAt` forward. History lives in the
`#DONE#` items; the task itself always represents the next occurrence.

- **Becomes due** at `dueAt - leadTimeDays`. `notifyAfter` is set, GSI1 keys are
  written, the alert appears on the household page.
- **Snooze** sets `snoozedUntil` and pushes `notifyAfter` (default +24h; other
  options offered). External delivery pauses; the in-app alert stays.
- **Dismiss** sets `dismissed` and **strips the GSI1 keys**. External delivery
  stops entirely. The in-app alert remains, because dismissal is about silencing
  the phone, not about pretending the dog is clean.
- **Complete** appends the completion record, clears `snoozedUntil` and
  `dismissed`, and either advances `dueAt` per the recurrence (rewriting the
  GSI1 keys for the next cycle) or sets `status: 'completed'` and strips them.

Concurrent edits use the same optimistic-concurrency pattern as Poster Walls: a
`version` attribute and a `ConditionExpression`, with membership folded into the
condition so a non-member's write fails indistinguishably from a stale one.

### Google Calendar sync (not built; kept open)

Not in scope, but likely enough that the model should not preclude it. The
shape it would take:

**Occurrences, not recurring events.** An `anchor: 'completion'` task cannot be
expressed as an RRULE — its next date is unknown until it is completed — so a
task syncs as a **single, non-recurring Google event for its current `dueAt`
only**. On completion, we write the next occurrence's event. This falls out of
the one-record-with-a-moving-`dueAt` model for free. (`anchor: 'schedule'`
tasks *could* map to a genuine recurring event later, since their dates are
knowable in advance; there is no reason to special-case that on day one.)

**Storage.** Two nullable attributes on the task — `googleEventId` and
`googleCalendarId` — plus a per-household record naming the target calendar.
Nothing about the core task shape changes.

**Auth.** Google OAuth per *user*, offline access, `calendar.events` scope.
Refresh tokens are the one genuine new security surface: they belong in Secrets
Manager, not the table.

**Direction.** Outbound first — our tasks appear in Google — which is the
valuable 80% and needs no webhooks. Inbound (drag the event in Google, the due
date moves here) needs either a watch channel with a public callback or
incremental polling with a stored `syncToken`, and should be its own decision
later.

**Seam.** The write path already funnels every date change through
complete/snooze/reschedule. Sync hangs off that as an adapter, exactly as the
`notify(user, alerts)` interface in §8 does for delivery — the reason both are
worth naming now is that they are the same seam, and building either one
without it means retrofitting both.

---

## 7. API surface

Versioned under `/v1`. Bearer JWT from Cognito, verified with `aws-jwt-verify`.
A membership middleware resolves `:hid` and rejects non-members with 404 rather
than 403, so household IDs cannot be probed.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/v1/me` | profile, households, `lastHouseholdId`; claims pending invites |
| PUT | `/v1/me/last-household` | remember the switcher's selection |
| POST/GET | `/v1/households` | create / list |
| GET/PATCH/DELETE | `/v1/households/:hid` | delete restricted to creator |
| GET/POST/DELETE | `/v1/households/:hid/invites` | manage pending invites |
| GET/DELETE | `/v1/households/:hid/members` | list; remove or leave |
| GET/POST | `/v1/households/:hid/boards` | list / create |
| GET/PATCH/DELETE | `/v1/households/:hid/boards/:bid` | manage a board |
| GET | `/v1/households/:hid/alerts` | everything currently nagging |
| GET/POST | `/v1/households/:hid/boards/:bid/tasks` | list / create |
| PATCH/DELETE | `/v1/households/:hid/boards/:bid/tasks/:tid` | edit / remove |
| POST | `…/tasks/:tid/complete` | complete and reschedule |
| POST | `…/tasks/:tid/snooze` | `{ until }` or a preset |
| POST | `…/tasks/:tid/dismiss` | silence external delivery |
| GET | `/openapi.json`, `/docs` | published contract |

**Invite claiming** happens on `GET /v1/me`: query `INVITE#<email>` for the
caller's verified email, convert any hits into memberships transactionally, and
delete the invite pair. This is what lets someone be invited before they have an
account — they sign up, and the household is simply there.

Errors follow Poster Walls' `ApiError` shape: a stable code plus a message,
never leaking whether a resource exists.

---

## 8. Reminder delivery

An EventBridge rule invokes a reminder Lambda **hourly**. The Lambda:

1. Queries GSI1 for `notifyAfter <= now`.
2. Groups results by household member with email notifications enabled.
3. Sends one digest per person via SES — several overdue chores are one email,
   not five.
4. Sets `notifyAfter = now + 24h` on each task it reported.

Hourly is the balance point: it honours a 4-hour snooze without needing a
scheduled job per task, and costs nothing meaningful at this volume.

**SES.** A domain identity on `household-manager.chrisbridewell.dev`, sending
from `reminders@`. Its DKIM records are created automatically in the hosted zone
this stack owns, so email requires no manual DNS. The account already has SES
production access (verified 2026-08-16: 200 messages/day, 1/sec) and no existing
verified identities, so this is the first.

The delivery layer is written behind a small interface — `notify(user, alerts)`
— so web push and native push become additional implementations rather than a
rewrite.

---

## 9. Infrastructure

Two stacks, both `us-east-1`, both tagged `project=household-manager` and
`environment=prd`.

**`HouseholdManagerBootstrap`** — the GitHub Actions OIDC deploy role. Deployed
once, by hand, from a local admin identity, because it is what lets Actions
deploy everything else. It **references** the account's existing OIDC provider
rather than creating one: the provider is an account-level singleton keyed on
its URL, and PosterWalls' bootstrap already owns it. The trust policy accepts
both GitHub subject forms (`repo:CrispyCabot/household-manager:*` and the
immutable-ID form with owner `18431358`, repo `1336082588`).

**`HouseholdManager`** — hosted zone, certificate, S3 + CloudFront for the SPA,
HTTP API + Lambda for the API, DynamoDB table, SES identity, EventBridge rule +
reminder Lambda, and the Cognito app client on the imported pool.

### The two-phase domain switch

Identical to Poster Walls, and forced by ACM: a DNS-validated certificate cannot
be issued until the zone answers, and the zone cannot answer until its
nameservers are delegated at the registrar.

- **Phase 1** — `useCustomDomain: false`. Creates the hosted zone and outputs
  its nameservers. The app is reachable on the CloudFront URL.
- **Delegate** — the four NS records go in at the registrar (see §11).
- **Phase 2** — `useCustomDomain: true`. Adds the certificate (covering both
  `household-manager.chrisbridewell.dev` and `api.…`), the CloudFront alias, the
  API domain name, the A/AAAA aliases — **and the SES identity**, which is gated
  to this phase for the same reason the certificate is: its DKIM records cannot
  validate until the zone resolves.

Both the CloudFront URL and the custom domain stay registered as Cognito
callback origins through the cutover, so a session started on one is not
stranded by the switch.

### Deployment

`.github/workflows/deploy.yml`, mirroring Poster Walls: verify (typecheck,
build, `cdk synth`), then deploy infrastructure, then read stack outputs, build
the SPA against them, sync to S3, invalidate CloudFront. The SPA's Cognito
configuration comes from the CoreInfra SSM parameters, not from this stack.

---

## 10. Web app

React 19, Vite, React Router, TanStack Query, `oidc-client-ts` — the same set
Poster Walls uses.

Mobile first in the literal sense: a single column, thumb-reachable primary
actions, and a bottom-anchored nav on small screens that becomes a header on
larger ones. Layout scales up from the phone; it is not a desktop layout
squeezed down.

- **Household switcher** — a dropdown in the masthead, defaulting to
  `lastHouseholdId` from the profile and writing back on change.
- **Household home** — the alert banner first (it is the reason the app exists),
  then the grid of board cards.
- **Board pages** — one route per board, resolved through the registry.

Visual direction is deliberately left to implementation, where the
`frontend-design` skill applies.

---

## 11. DNS records to set by hand

Exactly one set, at the registrar for `chrisbridewell.dev`:

| Type | Host | Value |
| ---- | ---- | ----- |
| NS | `household-manager` | the four nameservers from the phase-1 `ZoneNameServers` output |

Everything else — ACM validation records, SES DKIM CNAMEs, the A/AAAA aliases
for the app and API — is created inside the delegated zone by CDK.

---

## 12. Manual steps required of the operator

Claude cannot run `cdk deploy` locally (blocked by the Claude Code auto-mode
classifier), so these are hand-offs:

1. Deploy `HouseholdManagerBootstrap` locally, from an admin identity.
2. Set repository secret `AWS_DEPLOY_ROLE_ARN` and variable `AWS_REGION`.
3. Add the NS records above once phase 1 has deployed.
4. Flip `useCustomDomain` to `true` and let Actions deploy phase 2.

Phase 0's four deploys are likewise operator-run, and step 4 of it takes login
down briefly across all apps on the shared pool.

## Verification

`PRACTICES.md` forbids tests unless explicitly requested, so the plans contain
none. CI verifies via `npm run typecheck`, `npm run build`, and
`npx cdk synth --quiet`.

This is worth revisiting for one area only: the recurrence and lead-time
arithmetic in §6 (month-end clamping, anchor selection, the snooze/dismiss
transitions) is pure, self-contained, and the one place where a silent error
produces a wrong date rather than a visible failure.

---

## Phasing

Phase 0 is the Cognito relocation, in the infrastructure repo. The rest, each
independently deployable and useful:

1. **Foundation** — monorepo, CDK stacks, app client on the shared pool, auth
   end to end, household CRUD, invites and claiming, the switcher, and the
   dashboard shell rendering an empty board registry.
2. **Tasks** — the tasks board type: CRUD, recurrence with both anchors,
   complete-and-reschedule, in-app alerts, snooze and dismiss.
3. **Delivery** — SES identity, the hourly reminder Lambda, digest emails, and
   the `notify` interface that later carries push.
