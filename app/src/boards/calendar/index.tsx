import { CalendarBoardConfigSchema } from '@hhm/shared';
import type { Board } from '@hhm/shared';
import { Link } from 'react-router';
import { useBoardEvents } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { CalendarBoardPage } from './CalendarBoardPage.js';

const PREVIEW_LIMIT = 3;
const PREVIEW_DAYS = 7;

function Card({ board }: { board: Board }) {
  const config = CalendarBoardConfigSchema.parse(board.config);
  const from = new Date();
  const to = new Date();
  to.setDate(from.getDate() + PREVIEW_DAYS);
  const { data } = useBoardEvents(board.householdId, board.id, { from: from.toISOString(), to: to.toISOString() });
  const events = (data?.events ?? []).slice(0, PREVIEW_LIMIT);

  return (
    <div className="card task-card">
      <Link to={`/households/${board.householdId}/boards/${board.id}`} className="task-card__header">
        <strong>{board.title}</strong>
        <p>{config.calendars.filter((c) => c.enabled).length} calendar{config.calendars.filter((c) => c.enabled).length === 1 ? '' : 's'}</p>
      </Link>
      {events.length > 0 && (
        <div className="task-card__preview">
          {events.map((event) => (
            <div key={event.id} className="task-card__preview-item">
              <span className="task-card__preview-title">{event.title}</span>
              <span className="task-card__preview-due">
                {' '}
                {event.allDay ? new Date(`${event.start}T00:00:00`).toLocaleDateString() : new Date(event.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

registerBoardTypeUi('calendar', { Card, Page: CalendarBoardPage });
