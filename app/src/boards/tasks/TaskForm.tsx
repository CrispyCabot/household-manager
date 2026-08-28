import { useState } from 'react';
import type { CreateTaskInput, RecurrenceUnit, Task } from '@hhm/shared';
import { useCreateTask, useUpdateTask } from '../../api/queries.js';

interface TaskFormProps {
  householdId: string;
  boardId: string;
  /** When present, the form edits this task instead of creating a new one. */
  task?: Task;
  onDone: () => void;
  onCancel: () => void;
}

export function TaskForm({ householdId, boardId, task, onDone, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [dueAt, setDueAt] = useState(task !== undefined ? task.dueAt.slice(0, 10) : '');
  const [recurs, setRecurs] = useState(task?.recurrence !== null && task?.recurrence !== undefined);
  const [every, setEvery] = useState(String(task?.recurrence?.every ?? 1));
  const [unit, setUnit] = useState<RecurrenceUnit>(task?.recurrence?.unit ?? 'month');
  const [anchor, setAnchor] = useState<'completion' | 'schedule'>(task?.recurrence?.anchor ?? 'completion');
  const [leadTimeDays, setLeadTimeDays] = useState(task?.leadTimeDays ?? 0);
  const [notifyTimeOfDay, setNotifyTimeOfDay] = useState(task?.notifyTimeOfDay ?? '');
  const [syncToCalendar, setSyncToCalendar] = useState<'inherit' | 'yes' | 'no'>(
    task?.syncToCalendar === true ? 'yes' : task?.syncToCalendar === false ? 'no' : 'inherit',
  );
  const createTask = useCreateTask(householdId, boardId);
  const updateTask = useUpdateTask(householdId, boardId);
  const isEditing = task !== undefined;
  const isPending = createTask.isPending || updateTask.isPending;

  return (
    <form
      className="task-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '' || dueAt === '') return;
        const everyValue = Math.max(1, Math.trunc(Number(every)) || 1);
        const input: CreateTaskInput = {
          title: title.trim(),
          description: task?.description ?? '',
          dueAt: new Date(dueAt).toISOString(),
          recurrence: recurs ? { every: everyValue, unit, anchor } : null,
          leadTimeDays,
          notifyTimeOfDay: notifyTimeOfDay === '' ? null : notifyTimeOfDay,
          notify: task?.notify ?? { inApp: true, email: true },
          syncToCalendar: syncToCalendar === 'inherit' ? null : syncToCalendar === 'yes',
        };
        if (isEditing) {
          updateTask.mutate({ taskId: task.id, input: { ...input, version: task.version } }, { onSuccess: onDone });
        } else {
          createTask.mutate(input, { onSuccess: onDone });
        }
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Clean the dog" autoFocus />
      <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      <label>
        <input type="checkbox" checked={recurs} onChange={(e) => setRecurs(e.target.checked)} />
        Repeats
      </label>
      {recurs && (
        <div className="task-form__recur">
          every
          <input type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} />
          <select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}>
            <option value="day">day(s)</option>
            <option value="week">week(s)</option>
            <option value="month">month(s)</option>
            <option value="year">year(s)</option>
          </select>
          <select value={anchor} onChange={(e) => setAnchor(e.target.value as 'completion' | 'schedule')}>
            <option value="completion">from when it's done</option>
            <option value="schedule">from the original date</option>
          </select>
        </div>
      )}
      <label className="task-form__field">
        Start nagging
        <input
          type="number"
          min={0}
          className="task-form__field-input"
          value={leadTimeDays}
          onChange={(e) => setLeadTimeDays(Math.max(0, Number(e.target.value)))}
        />
        days early
      </label>
      <label className="task-form__field">
        Notify at
        <input
          type="time"
          value={notifyTimeOfDay}
          onChange={(e) => setNotifyTimeOfDay(e.target.value)}
        />
        Eastern time (defaults to midnight)
      </label>
      <label className="task-form__field">
        Google Calendar
        <select value={syncToCalendar} onChange={(e) => setSyncToCalendar(e.target.value as 'inherit' | 'yes' | 'no')}>
          <option value="inherit">Follow this board's setting</option>
          <option value="yes">Always sync</option>
          <option value="no">Never sync</option>
        </select>
      </label>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isEditing ? 'Save changes' : 'Add task'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
