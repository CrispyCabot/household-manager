# Feature Roadmap

### Eastern-time notification defaults, custom notify time, and Snooze rework (2026-08-24)

All four items previously listed here are implemented:

**Default to EST, and the "8:34" bug.** Two compounding bugs caused it:
`api/src/db/tasks.ts`/`packages/shared/src/boards/tasks/recurrence.ts`'s
`nagStart()` only shifted whole UTC days, leaving whatever hour a task's
`dueAt` happened to carry untouched — and since the task form only collects
a date (`app/src/boards/tasks/TaskForm.tsx`), that hour was always UTC
midnight, not Eastern midnight. Separately,
`infrastructure/lib/constructs/reminder.ts`'s hourly trigger used
`events.Schedule.rate(Duration.hours(1))`, which fires every 60 minutes from
whenever the rule was last deployed rather than from any wall-clock
boundary — so the sweep itself could land on any `:MM`. Fixed by:
- A new `easternWallClockToUtcIso()` (`packages/shared/src/time.ts`,
  tested in `time.test.ts` across EST, EDT, and both DST transition
  boundaries) that converts a date + time-of-day, read as a wall-clock
  reading in `America/New_York`, to the correct UTC instant.
- `nagStart()` now calls it, so "start of day" means Eastern midnight, not
  UTC midnight (tested in `recurrence.test.ts`).
- The EventBridge rule now uses `events.Schedule.cron({ minute: '0' })` —
  aligned to the top of every hour.

**Custom notification start time.** Tasks now carry an optional
`notifyTimeOfDay` field (`"HH:mm"`, Eastern, nullable — `null` keeps the
midnight default) — `packages/shared/src/boards/tasks/schemas.ts`,
threaded through `createTask`/`updateTask`/`completeTask`/
`listAlertsForHousehold` in `api/src/db/tasks.ts`. `TaskForm.tsx` has a new
"Notify at" time picker.

**Manual Snooze is back**, on both surfaces it was pulled from in the prior
entry below, with the requested modifications:
- The in-app alert banner (`app/src/components/AlertBanner.tsx`) shows a
  "Notifies every X" indicator per alert (via the existing
  `renotifyIntervalHours`/`formatRenotifyInterval`, now also exported and
  used client-side) and a Snooze button that opens a duration picker sized
  to that task's own cadence — an hourly-renotifying task is snoozed in
  hours, a daily one in days, a weekly one in weeks (new `snoozeUnitFor()`
  in `packages/shared/src/boards/tasks/recurrence.ts`, tested). The picker's
  copy spells out that the snooze is measured from right now, not from the
  next scheduled notification — so a full-cycle snooze taken right when a
  notification arrives typically skips more than one cycle.
- The reminder digest email (`api/src/reminder.ts`'s `digestHtml`) has its
  "Complete / Dismiss" row back to "Complete / Snooze / Dismiss", plus a
  "notifies every X" line per task. The email link can't offer an
  interactive duration picker, so it snoozes for the task's own renotify
  interval — unchanged from what the pre-existing action-token scaffolding
  (`api/src/routes/actions.ts`) already did with a snooze link, since that
  scaffolding was never removed, only unused.

No backend snooze *mechanics* changed — `snoozeTask`
(`api/src/db/tasks.ts`), the `/snooze` route, and the `'snooze'`
action-token flow were already correct and are reused as-is; this was a UI
re-attachment plus the timezone/cron/custom-time work above.

Also added: a vitest test runner for `packages/shared`
(`packages/shared/vitest.config.ts`) — none existed before, and the
timezone math above is DST-sensitive enough to need automated coverage
rather than manual spot-checks.

### Manual "Snooze" (2026-08-18)

The user-facing Snooze button has been removed from every surface that
exposed it:

- The in-app alert banner (`app/src/components/AlertBanner.tsx`) — was
  "Done / Snooze / Dismiss", now "Done / Dismiss".
- The reminder digest email (`api/src/reminder.ts`'s `digestHtml`) — was
  "Complete / Snooze / Dismiss", now "Complete / Dismiss".

**Why:** `reminder.ts`'s hourly handler already auto-renotifies every
still-outstanding task after each send (`renotifyIntervalHours`, keyed off
the task's recurrence — hourly for daily/weekly tasks, daily for monthly,
weekly for yearly). A manual snooze from an email that had just gone out was
redundant with pacing the system already does on its own, and read as
confusing UX ("why would I snooze something I just got auto-scheduled to
hear about again anyway?").

**Scaffolding kept in place, not deleted**, so this is reversible by
re-adding a button rather than rebuilding the mechanism:

- `POST /v1/households/:householdId/boards/:boardId/tasks/:taskId/snooze`
  (`api/src/routes/tasks.ts`) and `snoozeTask` (`api/src/db/tasks.ts`) —
  unchanged.
- `useSnoozeTask` (`app/src/api/queries.ts`) — unchanged, just currently
  unused by any component.
- The `'snooze'` action-token type end to end (`api/src/actionToken.ts`,
  `api/src/routes/actions.ts`'s GET confirm page and POST handler) —
  unchanged, so any already-sent email with a snooze link from before this
  change still works if clicked.
- `SnoozeTaskInput` schema (`packages/shared/src/boards/tasks/schemas.ts`) —
  unchanged.

No new snooze action tokens or in-app snooze requests are issued going
forward; the auto-renotify-until-complete/dismiss behavior is unaffected.
