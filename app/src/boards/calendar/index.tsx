import { CalendarBoardConfigSchema } from '@hhm/shared';
import type { Board } from '@hhm/shared';
import { Link } from 'react-router';
import { useBoardEvents } from '../../api/queries.js';
import { registerBoardTypeUi } from '../registry.js';
import { AgendaList } from './AgendaList.js';
import { CalendarBoardPage } from './CalendarBoardPage.js';

const PREVIEW_LIMIT = 3;
const PREVIEW_DAYS = 7;
const DASHBOARD_DEFAULT_MAX_DAYS = 4;

/** More room on a dashboard tile means more day-groups shown — same scaling idea as the tasks board's Card, capped well short of "the whole board". */
function dashboardMaxDays(size: { w: number; h: number } | undefined): number {
  if (size === undefined) return DASHBOARD_DEFAULT_MAX_DAYS;
  return Math.min(14, Math.max(3, size.h));
}

function CalendarCount({ board }: { board: Board }) {
  const count = CalendarBoardConfigSchema.parse(board.config).calendars.filter((c) => c.enabled).length;
  return <p>{count} calendar{count === 1 ? '' : 's'}</p>;
}

/**
 * `dashboard` (registry.tsx) is the whole point of this branch: the ordinary
 * board grid (Home.tsx) always gets the compact multi-line preview below,
 * regardless of the board's saved view — there's no "which view" control on
 * a small card among many. On the wall dashboard, there's no view switcher
 * either (that's CalendarBoardPage's job), so showing the household's own
 * saved default view (agenda/week/month) there is what "open the dashboard
 * and see your calendar the way you set it up" actually means.
 */
function Card({ board, size, dashboard }: { board: Board; size?: { w: number; h: number }; dashboard?: boolean }) {
  const config = CalendarBoardConfigSchema.parse(board.config);

  if (dashboard === true) {
    return (
      <div className="card task-card">
        <Link to={`/households/${board.householdId}/boards/${board.id}`} className="task-card__header">
          <strong>{board.title}</strong>
          <CalendarCount board={board} />
        </Link>
        <AgendaList board={board} view={config.defaultView} daysAhead={config.daysAhead} maxDays={dashboardMaxDays(size)} />
      </div>
    );
  }

  return <CompactCard board={board} />;
}

function CompactCard({ board }: { board: Board }) {
  const from = new Date();
  const to = new Date();
  to.setDate(from.getDate() + PREVIEW_DAYS);
  const { data } = useBoardEvents(board.householdId, board.id, { from: from.toISOString(), to: to.toISOString() });
  const events = (data?.events ?? []).slice(0, PREVIEW_LIMIT);

  return (
    <div className="card task-card">
      <Link to={`/households/${board.householdId}/boards/${board.id}`} className="task-card__header">
        <strong>{board.title}</strong>
        <CalendarCount board={board} />
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
