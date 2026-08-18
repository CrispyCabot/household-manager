import { useState } from 'react';
import { renotifyIntervalHours } from '@hhm/shared';
import type { Recurrence } from '@hhm/shared';
import { useAlerts, useCompleteTask, useDismissTask, useSnoozeTask } from '../api/queries.js';

/** "1 hour" / "24 hours" -> "1 day" / "168 hours" -> "1 week" — whichever unit divides evenly, else falls back to hours. */
function formatInterval(hours: number): string {
  if (hours % (24 * 7) === 0) {
    const weeks = hours / (24 * 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

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

type ConfirmState = 'none' | 'snooze' | 'dismiss';

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
  const complete = useCompleteTask(householdId, boardId);
  const snooze = useSnoozeTask(householdId, boardId);
  const dismiss = useDismissTask(householdId, boardId);
  const isPending = complete.isPending || snooze.isPending || dismiss.isPending;
  const intervalHours = renotifyIntervalHours(recurrence);

  return (
    <div className="alert-row" role="alert">
      <span>{title} is due</span>
      <div className="alert-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(taskId)} disabled={isPending}>
          Done
        </button>
        <button type="button" className="btn-small" onClick={() => setConfirming('snooze')} disabled={isPending}>
          Snooze
        </button>
        <button type="button" className="btn-small" onClick={() => setConfirming('dismiss')} disabled={isPending}>
          Dismiss
        </button>
      </div>

      {confirming === 'snooze' && (
        <div className="modal-backdrop" onClick={() => setConfirming('none')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Snooze "{title}"?</h2>
            <p className="notice">You won't be notified again until {formatInterval(intervalHours)} from now.</p>
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={snooze.isPending}
                onClick={() =>
                  snooze.mutate({ taskId, input: { hours: intervalHours } }, { onSuccess: () => setConfirming('none') })
                }
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
    </div>
  );
}
