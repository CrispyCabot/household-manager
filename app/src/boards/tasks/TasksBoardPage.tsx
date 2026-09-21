import { Settings } from 'lucide-react';
import { useState } from 'react';
import type { Board } from '@hhm/shared';
import { useTasks } from '../../api/queries.js';
import { TaskForm } from './TaskForm.js';
import { TaskRow } from './TaskCard.js';
import { TasksConfigPanel } from './TasksConfigPanel.js';

export function TasksBoardPage({ board }: { board: Board }) {
  const { data, isLoading } = useTasks(board.householdId, board.id);
  const [adding, setAdding] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="page">
      <div className="household-header">
        <h1>{board.title}</h1>
        <div className="household-header__actions">
          <button type="button" className="masthead__iconbtn" title="Tasks settings" onClick={() => setConfigOpen(true)}>
            <Settings size={18} />
          </button>
        </div>
      </div>

      {isLoading && <p className="notice">Loading…</p>}
      {!isLoading && (data?.tasks.length ?? 0) === 0 && !adding && <div className="empty">No tasks yet.</div>}
      <div className="task-list">
        {[...(data?.tasks ?? [])]
          .sort((a, b) => {
            if (a.status !== b.status) {
              return a.status === 'completed' ? 1 : -1;
            }
            return a.dueAt.localeCompare(b.dueAt);
          })
          .map((task) => (
            <TaskRow key={task.id} householdId={board.householdId} task={task} />
          ))}
      </div>

      {adding ? (
        <TaskForm
          householdId={board.householdId}
          boardId={board.id}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="board-toolbar">
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            + Add task
          </button>
        </div>
      )}

      {configOpen && <TasksConfigPanel board={board} onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
