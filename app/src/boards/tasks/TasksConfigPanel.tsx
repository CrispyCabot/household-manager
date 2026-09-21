import type { Board } from '@hhm/shared';
import { useDisconnectGoogle, useGoogleAuthUrl, useGoogleConnection } from '../../api/queries.js';

/**
 * Manages this household's Google account connection only. Which calendar
 * each task syncs to is chosen per-task now, in TaskForm — a household's
 * tasks commonly belong to different people who each want their own tasks
 * on their own calendar, not one calendar for the whole board.
 */
export function TasksConfigPanel({ board, onClose }: { board: Board; onClose: () => void }) {
  const { householdId } = board;
  const { data: connectionData, isLoading: connectionLoading } = useGoogleConnection(householdId);
  const connection = connectionData?.connection ?? null;
  const authUrl = useGoogleAuthUrl(householdId);
  const disconnect = useDisconnectGoogle(householdId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Tasks settings</h2>

        {connectionLoading ? (
          <p className="notice">Loading…</p>
        ) : connection === null ? (
          <>
            <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
              Connect a Google account to let individual tasks sync onto a calendar of your choice.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={authUrl.isPending}
              onClick={() => authUrl.mutate(undefined, { onSuccess: ({ url }) => window.location.assign(url) })}
            >
              Connect Google Calendar
            </button>
          </>
        ) : (
          <>
            <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
              Connected as <strong>{connection.googleAccountEmail}</strong>
              {connection.status === 'needs_reauth' && ' — reconnect needed, Google revoked access.'}
            </p>
            {connection.status === 'needs_reauth' ? (
              <button
                type="button"
                className="btn-primary"
                disabled={authUrl.isPending}
                onClick={() => authUrl.mutate(undefined, { onSuccess: ({ url }) => window.location.assign(url) })}
              >
                Reconnect
              </button>
            ) : (
              <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
                Turn on "Sync to Google Calendar" on any task to pick which calendar it goes to.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn-danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Disconnect Google
              </button>
            </div>
          </>
        )}

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
