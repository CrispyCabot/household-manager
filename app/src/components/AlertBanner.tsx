import { useState } from 'react';
import { Link } from 'react-router';
import { effectiveRenotifyIntervalHours, formatDurationHours, formatNextNotified, formatRenotifyInterval } from '@hhm/shared';
import type { Task } from '@hhm/shared';
import { useAlerts, useCompleteTask, useDismissTask, useSnoozeTask } from '../api/queries.js';

export function AlertBanner({ householdId }: { householdId: string }) {
  const { data, isLoading } = useAlerts(householdId);
  if (isLoading || (data?.alerts.length ?? 0) === 0) return null;

  return (
    <div className="alert-banner">
      {data!.alerts.map((task) => (
        <AlertRow key={task.id} householdId={householdId} task={task} />
      ))}
    </div>
  );
}

type ConfirmState = 'none' | 'dismiss' | 'snooze';

/** The snooze slider's range — 1 hour to `SnoozeTaskSchema`'s own 30-day ceiling (`packages/shared/src/boards/tasks/schemas.ts`), so every value it can produce is always a valid snooze. */
const MIN_SNOOZE_HOURS = 1;
const MAX_SNOOZE_HOURS = 24 * 30;
/** The +/- buttons flanking the slider — dragging precisely to a specific hour across a 720-hour range is fiddly, so they step by the smallest unit the slider itself resolves to. */
const SNOOZE_STEP_HOURS = 1;

function AlertRow({ householdId, task }: { householdId: string; task: Task }) {
  const [confirming, setConfirming] = useState<ConfirmState>('none');
  const [snoozeHours, setSnoozeHours] = useState(1);
  const complete = useCompleteTask(householdId, task.boardId);
  const dismiss = useDismissTask(householdId, task.boardId);
  const snooze = useSnoozeTask(householdId, task.boardId);
  const isPending = complete.isPending || dismiss.isPending || snooze.isPending;

  const renotifyHours = effectiveRenotifyIntervalHours(task);

  return (
    <div className="alert-row" role="alert">
      <Link to={`/households/${householdId}/boards/${task.boardId}`} className="alert-row__link">
        <span>{task.title} is due. </span>
        <span className="alert-row__frequency">Notifies every {formatRenotifyInterval(renotifyHours)}</span>
      </Link>
      <div className="alert-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(task.id)} disabled={isPending}>
          Done
        </button>
        <button
          type="button"
          className="btn-small"
          onClick={() => {
            // Defaults to exactly what the task would do on its own (its
            // effective renotify interval) — the same value the email's
            // one-shot snooze link applies, since a static email link can't
            // offer this slider (see actionCopy in api/src/routes/actions.ts).
            setSnoozeHours(Math.min(renotifyHours, MAX_SNOOZE_HOURS));
            setConfirming('snooze');
          }}
          disabled={isPending}
        >
          Snooze
        </button>
        <button type="button" className="btn-small" onClick={() => setConfirming('dismiss')} disabled={isPending}>
          Dismiss
        </button>
      </div>

      {confirming === 'dismiss' && (
        <div className="modal-backdrop" onClick={() => setConfirming('none')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Dismiss "{task.title}"?</h2>
            <p className="notice">
              This stops reminder emails until it's next due. It'll still show here until you complete it.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(task.id, { onSuccess: () => setConfirming('none') })}
              >
                Continue
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirming('none')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming === 'snooze' && (
        <div className="modal-backdrop" onClick={() => setConfirming('none')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Snooze "{task.title}"?</h2>
            <p className="notice">This task normally notifies every {formatRenotifyInterval(renotifyHours)}.</p>
            <div className="alert-row__snooze-input">
              <span>Snooze for {formatDurationHours(snoozeHours)}</span>
              <div className="alert-row__snooze-slider">
                <button
                  type="button"
                  className="alert-row__snooze-step"
                  disabled={snoozeHours <= MIN_SNOOZE_HOURS}
                  onClick={() => setSnoozeHours((h) => Math.max(MIN_SNOOZE_HOURS, h - SNOOZE_STEP_HOURS))}
                  aria-label="Decrease by 1 hour"
                >
                  −
                </button>
                <input
                  type="range"
                  min={MIN_SNOOZE_HOURS}
                  max={MAX_SNOOZE_HOURS}
                  value={snoozeHours}
                  onChange={(e) => setSnoozeHours(Number(e.target.value))}
                />
                <button
                  type="button"
                  className="alert-row__snooze-step"
                  disabled={snoozeHours >= MAX_SNOOZE_HOURS}
                  onClick={() => setSnoozeHours((h) => Math.min(MAX_SNOOZE_HOURS, h + SNOOZE_STEP_HOURS))}
                  aria-label="Increase by 1 hour"
                >
                  +
                </button>
              </div>
              <span className="alert-row__snooze-range-ends">
                <span>1 hour</span>
                <span>30 days</span>
              </span>
            </div>
            <p className="notice">
              You'll be notified again around <strong>{formatNextNotified(Date.now() + snoozeHours * 3_600_000)}</strong>.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={snooze.isPending}
                onClick={() =>
                  snooze.mutate(
                    { taskId: task.id, input: { hours: snoozeHours } },
                    { onSuccess: () => setConfirming('none') },
                  )
                }
              >
                Snooze
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirming('none')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
