import { useAlerts, useCompleteTask, useDismissTask, useSnoozeTask } from '../api/queries.js';

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
  const complete = useCompleteTask(householdId, boardId);
  const snooze = useSnoozeTask(householdId, boardId);
  const dismiss = useDismissTask(householdId, boardId);
  const isPending = complete.isPending || snooze.isPending || dismiss.isPending;

  return (
    <div className="alert-row" role="alert">
      <span>{title} is due</span>
      <div className="alert-row__actions">
        <button type="button" className="btn-primary" onClick={() => complete.mutate(taskId)} disabled={isPending}>
          Done
        </button>
        <button type="button" className="btn-small" onClick={() => snooze.mutate({ taskId, input: { hours: 24 } })} disabled={isPending}>
          Snooze 24h
        </button>
        <button type="button" className="btn-small" onClick={() => dismiss.mutate(taskId)} disabled={isPending}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
