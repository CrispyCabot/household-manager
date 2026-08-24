import { useState } from 'react';
import { SNOOZE_UNIT_HOURS, formatRenotifyInterval, renotifyIntervalHours, snoozeUnitFor } from '@hhm/shared';
import type { Recurrence } from '@hhm/shared';
import { useAlerts, useCompleteTask, useDismissTask, useSnoozeTask } from '../api/queries.js';

export function AlertBanner({ householdId }: { householdId: string }) {
  const { data, isLoading } = useAlerts(householdId);
  if (isLoading || (data?.alerts.length ?? 0) === 0) return null;

  return (
    <div className="alert-banner">
      {data!.alerts.map((task) => (
        <AlertRow
          key={task.id}
          householdId={householdId}
          taskId={task.id}
          boardId={task.boardId}
          title={task.title}
          recurrence={task.recurrence}
        />
      ))}
    </div>
  );
}

type ConfirmState = 'none' | 'dismiss' | 'snooze';

function AlertRow({
  householdId,
  boardId,
  taskId,
  title,
  recurrence,
}: {
  householdId: string;
  boardId: string;
  taskId: string;
  title: string;
  recurrence: Recurrence | null;
}) {
  const [confirming, setConfirming] = useState<ConfirmState>('none');
  const [snoozeCount, setSnoozeCount] = useState(1);
  const complete = useCompleteTask(householdId, boardId);
  const dismiss = useDismissTask(householdId, boardId);
  const snooze = useSnoozeTask(householdId, boardId);
  const isPending = complete.isPending || dismiss.isPending || snooze.isPending;

  const renotifyHours = renotifyIntervalHours(recurrence);
  const snoozeUnit = snoozeUnitFor(renotifyHours);

  return (
    <div className="alert-row" role="alert">
      <span>{title} is due</span>
      <span className="alert-row__frequency">Notifies every {formatRenotifyInterval(renotifyHours)}</span>
      <div className="alert-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(taskId)} disabled={isPending}>
          Done
        </button>
        <button
          type="button"
          className="btn-small"
          onClick={() => {
            setSnoozeCount(1);
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
            <h2>Dismiss "{title}"?</h2>
            <p className="notice">
              This stops reminder emails until it's next due. It'll still show here until you complete it.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(taskId, { onSuccess: () => setConfirming('none') })}
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
            <h2>Snooze "{title}"?</h2>
            <p className="notice">
              Pauses future notifications for the duration you choose below, counted from right now — not from the
              next time this would normally notify. This task notifies every {formatRenotifyInterval(renotifyHours)},
              so snoozing for a full cycle (e.g. 1 {snoozeUnit}) right when a notification arrives usually skips more
              than one: the notification that would have landed partway through the snooze is paused too.
            </p>
            <label className="alert-row__snooze-input">
              Snooze for
              <input
                type="number"
                min={1}
                value={snoozeCount}
                onChange={(e) => setSnoozeCount(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
              />
              {snoozeUnit}
              {snoozeCount === 1 ? '' : 's'}
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={snooze.isPending}
                onClick={() =>
                  snooze.mutate(
                    { taskId, input: { hours: snoozeCount * SNOOZE_UNIT_HOURS[snoozeUnit] } },
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
