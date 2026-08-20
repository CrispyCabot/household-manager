# Feature Roadmap
- I'm seeing discrepancies in my email events. I created a task "Take out trash" that recurs once weekly. Based on that, I'm expecting to receive an email every hour if that task hasn't been complete. I haven't marked the task as complete, and I got one email at 3:34 PM EST and that's it. I would expect to get another email at 4:34 PM EST which has since passed. Can you investigate why this has happened and fix it
- If easily configurable, modify the email addres that is sending emails (currently reminders@household-manager.chrisbridewell.dev) to instead be based on the households name. So for example, if the household name is FryYayHouse, make it send from fryyayhouse-reminders@household-manager.chrisbridewell.dev. If it's not easily configurable, leave it alone
- There are some timezone discrepancies. For example, in my email reminder, I got an email at 3:34 PM but it said in the email subject 7:34 PM. Can you assume everything for the app should be in EST time. If possible, automatically pull the users local timezone when doing things. No timezone stuff should be user facing, it should all be handled in the back end, just something that 'works'.
- When editing a tasks recurring amount, I can't delete the default "1" since it probably fails a validation. Can you remove those validations until the "Add Task" button is clicked. This causes an inconvenience when editing, because if I want to change it to "2", I can't actually delete the "1", so I have to first type "12" then go back and remove the "1"

## Disabled functionality - do not implement unless explicity told - here for future reference

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
