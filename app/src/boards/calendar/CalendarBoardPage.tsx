import { CalendarBoardConfigSchema } from '@hhm/shared';
import type { Board, CalendarView } from '@hhm/shared';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { AgendaList } from './AgendaList.js';
import { rangeForView } from './agenda.js';
import { CalendarConfigPanel } from './CalendarConfigPanel.js';

export function CalendarBoardPage({ board }: { board: Board }) {
  const config = CalendarBoardConfigSchema.parse(board.config);
  const [view, setView] = useState<CalendarView>(config.defaultView);
  const [configOpen, setConfigOpen] = useState(false);
  const { days } = rangeForView(view, config.daysAhead);

  return (
    <div className="page">
      <div className="household-header">
        <h1>{board.title}</h1>
        <div className="household-header__actions">
          <button type="button" className="masthead__iconbtn" title="Calendar settings" onClick={() => setConfigOpen(true)}>
            <Settings size={18} />
          </button>
        </div>
      </div>

      <div className="calendar-view-tabs">
        {(['agenda', 'week', 'month'] as const).map((v) => (
          <button key={v} type="button" className={v === view ? 'btn-small btn-small--active' : 'btn-small'} onClick={() => setView(v)}>
            {v === 'agenda' ? `Next ${days} days` : v[0]!.toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <AgendaList board={board} view={view} daysAhead={config.daysAhead} />

      {configOpen && <CalendarConfigPanel board={board} onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
