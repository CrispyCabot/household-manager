# Feature Roadmap

## Disabled functionality

### Manual "Snooze" (2026-08-18)

The user-facing Snooze button has been removed from every surface that
exposed it:

- The in-app alert banner (`app/src/components/AlertBanner.tsx`) — was
  "Done / Snooze / Dismiss", now "Done / Dismiss".
- The reminder digest email (`api/src/reminder.ts`'s `digestHtml`) — was
  "Complete / Snooze / Dismiss", now "Complete / Dismiss".

**Why:** `reminder.ts`'s hourly handler already auto-renotifies every
still-outstanding task after each send (`renotifyIntervalHours`, keyed off
the task's recurrence — hourly for daily tasks, daily for weekly/monthly,
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
