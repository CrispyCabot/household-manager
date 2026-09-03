import { CalendarBoardConfigSchema } from '@hhm/shared';
import type { Board, CalendarSelection, CalendarView } from '@hhm/shared';
import { useState } from 'react';
import {
  useDisconnectGoogle,
  useGoogleAuthUrl,
  useGoogleCalendars,
  useGoogleConnection,
  useSaveBoardConfig,
} from '../../api/queries.js';

// A small, fixed palette rather than a free colour picker — keeps a
// household's calendars visually distinct without anyone having to think
// about it, same reasoning as the link board's curated icon set.
const PALETTE = ['#3f7d6b', '#b3413a', '#9a6b16', '#3b6ea5', '#7a4fa0', '#c25b8f'];

export function CalendarConfigPanel({ board, onClose }: { board: Board; onClose: () => void }) {
  const { householdId } = board;
  const config = CalendarBoardConfigSchema.parse(board.config);
  const { data: connectionData, isLoading: connectionLoading } = useGoogleConnection(householdId);
  const connection = connectionData?.connection ?? null;
  const authUrl = useGoogleAuthUrl(householdId);
  const disconnect = useDisconnectGoogle(householdId);
  const { data: calendarsData, isLoading: calendarsLoading } = useGoogleCalendars(householdId, connection?.status === 'connected');
  const saveConfig = useSaveBoardConfig(householdId, board.id);

  const [selections, setSelections] = useState<CalendarSelection[]>(config.calendars);
  const [defaultView, setDefaultView] = useState<CalendarView>(config.defaultView);

  const availableCalendars = calendarsData?.calendars ?? [];
  const selectionById = new Map(selections.map((s) => [s.id, s]));

  function toggleCalendar(id: string, label: string, index: number) {
    const existing = selectionById.get(id);
    if (existing !== undefined) {
      setSelections(selections.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
    } else {
      setSelections([...selections, { id, label, colour: PALETTE[index % PALETTE.length]!, enabled: true }]);
    }
  }

  const dirty = JSON.stringify(selections) !== JSON.stringify(config.calendars) || defaultView !== config.defaultView;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Calendar settings</h2>

        {connectionLoading ? (
          <p className="notice">Loading…</p>
        ) : connection === null ? (
          <>
            <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
              Connect a Google account to show its calendars here. Everyone in this household — and any wall
              display — will see the calendars you pick.
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
                <h3>Calendars to show</h3>
                {calendarsLoading ? (
                  <p className="notice">Loading calendars…</p>
                ) : (
                  <div className="task-list calendar-picker-list">
                    {availableCalendars.map((cal, i) => {
                      const selected = selectionById.get(cal.id);
                      return (
                        <label key={cal.id} className="task-row" style={{ cursor: 'pointer' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={selected?.enabled ?? false}
                              onChange={() => toggleCalendar(cal.id, cal.summary, i)}
                            />
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                background: selected?.colour ?? PALETTE[i % PALETTE.length],
                                display: 'inline-block',
                              }}
                            />
                            {cal.summary}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <h3>Default view</h3>
                <select value={defaultView} onChange={(e) => setDefaultView(e.target.value as CalendarView)}>
                  <option value="agenda">Agenda</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
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
              saveConfig.mutate({ ...config, calendars: selections, defaultView } as unknown as Record<string, unknown>, { onSuccess: onClose })
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
