import { useState } from 'react';
import { Link } from 'react-router';
import { EASTERN_TIME_ZONE, formatRenotifyInterval, renotifyIntervalHours } from '@hhm/shared';
import type { Recurrence } from '@hhm/shared';
import { useAlerts, useCompleteTask, useDismissTask, useSnoozeTask } from '../api/queries.js';

function formatNextNotification(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { timeZone: EASTERN_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' });
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
  const [skipCount, setSkipCount] = useState(1);
  const complete = useCompleteTask(householdId, boardId);
  const dismiss = useDismissTask(householdId, boardId);
  const snooze = useSnoozeTask(householdId, boardId);
  const isPending = complete.isPending || dismiss.isPending || snooze.isPending;

  const renotifyHours = renotifyIntervalHours(recurrence);

  return (
    <div className="alert-row" role="alert">
      <Link to={`/households/${householdId}/boards/${boardId}`} className="alert-row__link">
        <span>{title} is due</span>
        <span className="alert-row__frequency">Notifies every {formatRenotifyInterval(renotifyHours)}</span>
      </Link>
      <div className="alert-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(taskId)} disabled={isPending}>
          Done
        </button>
        <button
          type="button"
          className="btn-small"
          onClick={() => {
            setSkipCount(1);
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
            <p className="notice">This task normally notifies every {formatRenotifyInterval(renotifyHours)}.</p>
            <label className="alert-row__snooze-input">
              Skip
              <input
                type="number"
                min={1}
                value={skipCount}
                onChange={(e) => setSkipCount(Math.max(1, Math.trunc(Number(e.target.value)) || 1))}
              />
              notification{skipCount === 1 ? '' : 's'}
            </label>
            <p className="notice">
              You'll be notified again around{' '}
              <strong>{formatNextNotification(Date.now() + skipCount * renotifyHours * 3_600_000)}</strong>.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={snooze.isPending}
                onClick={() =>
                  snooze.mutate(
                    { taskId, input: { hours: skipCount * renotifyHours } },
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
