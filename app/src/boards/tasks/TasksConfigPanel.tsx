import { TasksBoardConfigSchema } from '@hhm/shared';
import type { Board } from '@hhm/shared';
import { useState } from 'react';
import {
  useDisconnectGoogle,
  useGoogleAuthUrl,
  useGoogleCalendars,
  useGoogleConnection,
  useSaveBoardConfig,
} from '../../api/queries.js';

/**
 * Sets `TasksBoardConfig.googleSync` — the one control this board type was
 * missing entirely (unlike `CalendarConfigPanel`, this is a single-select:
 * every synced task's event lands on exactly one calendar, not several).
 * Modeled on `../calendar/CalendarConfigPanel.tsx`'s connect/reconnect/
 * disconnect flow and its use of the shared Google-connection hooks.
 */
export function TasksConfigPanel({ board, onClose }: { board: Board; onClose: () => void }) {
  const { householdId } = board;
  const config = TasksBoardConfigSchema.parse(board.config);
  const { data: connectionData, isLoading: connectionLoading } = useGoogleConnection(householdId);
  const connection = connectionData?.connection ?? null;
  const authUrl = useGoogleAuthUrl(householdId);
  const disconnect = useDisconnectGoogle(householdId);
  const { data: calendarsData, isLoading: calendarsLoading } = useGoogleCalendars(householdId, connection?.status === 'connected');
  const saveConfig = useSaveBoardConfig(householdId, board.id);

  const [enabled, setEnabled] = useState(config.googleSync.enabled);
  const [calendarId, setCalendarId] = useState<string | null>(config.googleSync.calendarId);

  const availableCalendars = calendarsData?.calendars ?? [];
  const dirty = enabled !== config.googleSync.enabled || calendarId !== config.googleSync.calendarId;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Tasks settings</h2>

        {connectionLoading ? (
          <p className="notice">Loading…</p>
        ) : connection === null ? (
          <>
            <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
              Connect a Google account to sync tasks from this board onto a calendar.
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
              <>
                <label className="task-form__field">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  Sync tasks to Google Calendar by default
                </label>
                <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
                  Individual tasks can still override this — see a task's own "Google Calendar" field.
                </p>

                <h3>Calendar to sync to</h3>
                {calendarsLoading ? (
                  <p className="notice">Loading calendars…</p>
                ) : availableCalendars.length === 0 ? (
                  <p className="notice" style={{ padding: 0, textAlign: 'left' }}>No calendars found on this Google account.</p>
                ) : (
                  <select value={calendarId ?? ''} onChange={(e) => setCalendarId(e.target.value === '' ? null : e.target.value)}>
                    <option value="">Choose a calendar…</option>
                    {availableCalendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.summary}
                      </option>
                    ))}
                  </select>
                )}
                {enabled && calendarId === null && (
                  <p className="notice" style={{ padding: 0, textAlign: 'left', color: 'var(--danger)' }}>
                    Choose a calendar above — sync stays off, and synced tasks will show an error, until one is selected.
                  </p>
                )}
              </>
            )}
            <div className="form-actions">
              <button type="button" className="btn-danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Disconnect Google
              </button>
            </div>
          </>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty || saveConfig.isPending}
            onClick={() =>
              saveConfig.mutate({ googleSync: { enabled, calendarId } } as unknown as Record<string, unknown>, { onSuccess: onClose })
            }
          >
            Save
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
