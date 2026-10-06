import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useBoards, useTasks } from '../../api/queries.js';
import { AlertBanner } from '../../components/AlertBanner.js';
import { Loading } from '../../components/Loading.js';
import { TaskActions, TaskDetails } from './TaskCard.js';
import { TaskAudit } from './TaskAudit.js';
import { TaskForm } from './TaskForm.js';

/** A single task on its own screen: the same details, form, and buttons as the board's row, plus its audit log. */
export function TaskPage() {
  const { householdId, boardId, taskId } = useParams<{ householdId: string; boardId: string; taskId: string }>();
  const hid = householdId ?? '';
  const bid = boardId ?? '';
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const { data: boardsData } = useBoards(householdId ?? null);
  const { data, isLoading } = useTasks(hid, bid);

  if (isLoading) return <Loading />;
  const task = data?.tasks.find((t) => t.id === taskId);
  const boardTitle = boardsData?.boards.find((b) => b.id === boardId)?.title ?? 'Tasks';
  const boardPath = `/households/${hid}/boards/${bid}`;
  if (task === undefined) {
    return (
      <div className="page">
        <p className="notice">Task not found.</p>
        <Link to={boardPath} className="back-link">
          ← {boardTitle}
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="back-link-row">
        <Link to={boardPath} className="back-link">
          ← {boardTitle}
        </Link>
      </div>

      {editing ? (
        <TaskForm householdId={hid} boardId={bid} task={task} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <AlertBanner householdId={hid} boardId={bid} taskId={task.id} />
          <div className={task.status === 'completed' ? 'task-row task-row--completed' : 'task-row'}>
            <TaskDetails householdId={hid} task={task} expanded />
            <TaskActions householdId={hid} task={task} onEdit={() => setEditing(true)} onDeleted={() => navigate(boardPath)} />
          </div>
        </>
      )}

      <TaskAudit householdId={hid} boardId={bid} taskId={task.id} />
    </div>
  );
}
