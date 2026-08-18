import { useState } from 'react';
import { useAlerts, useCompleteTask, useDismissTask } from '../api/queries.js';

export function AlertBanner({ householdId }: { householdId: string }) {
  const { data, isLoading } = useAlerts(householdId);
  if (isLoading || (data?.alerts.length ?? 0) === 0) return null;

  return (
    <div className="alert-banner">
      {data!.alerts.map((task) => (
        <AlertRow key={task.id} householdId={householdId} taskId={task.id} boardId={task.boardId} title={task.title} />
      ))}
    </div>
  );
}

type ConfirmState = 'none' | 'dismiss';

function AlertRow({
  householdId,
  boardId,
  taskId,
  title,
}: {
  householdId: string;
  boardId: string;
  taskId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState<ConfirmState>('none');
  const complete = useCompleteTask(householdId, boardId);
  const dismiss = useDismissTask(householdId, boardId);
  const isPending = complete.isPending || dismiss.isPending;

  return (
    <div className="alert-row" role="alert">
      <span>{title} is due</span>
      <div className="alert-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(taskId)} disabled={isPending}>
          Done
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
    </div>
  );
}
