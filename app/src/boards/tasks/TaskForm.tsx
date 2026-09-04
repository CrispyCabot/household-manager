import { useState } from 'react';
import { defaultRenotifyIntervalHours, formatRenotifyInterval } from '@hhm/shared';
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

type RenotifyUnit = 'hour' | 'day' | 'week';

function renotifyUnitToHours(unit: RenotifyUnit): number {
  switch (unit) {
    case 'hour':
      return 1;
    case 'day':
      return 24;
    case 'week':
      return 24 * 7;
  }
}

/** The inverse of `every * renotifyUnitToHours(unit)` — picks whichever unit divides evenly, preferring the largest, so e.g. 48 shows as "every 2 day(s)" rather than "every 48 hour(s)". Falls back to hours for a value that doesn't land on a clean day/week boundary. */
function hoursToRenotifyEveryUnit(hours: number): { every: number; unit: RenotifyUnit } {
  if (hours % (24 * 7) === 0) return { every: hours / (24 * 7), unit: 'week' };
  if (hours % 24 === 0) return { every: hours / 24, unit: 'day' };
  return { every: hours, unit: 'hour' };
}

export function TaskForm({ householdId, boardId, task, onDone, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueAt, setDueAt] = useState(task !== undefined ? task.dueAt.slice(0, 10) : '');
  const [recurs, setRecurs] = useState(task?.recurrence !== null && task?.recurrence !== undefined);
  const [every, setEvery] = useState(String(task?.recurrence?.every ?? 1));
  const [unit, setUnit] = useState<RecurrenceUnit>(task?.recurrence?.unit ?? 'month');
  const [anchor, setAnchor] = useState<'completion' | 'schedule'>(task?.recurrence?.anchor ?? 'completion');
  const [leadTimeDays, setLeadTimeDays] = useState(task?.leadTimeDays ?? 0);
  const [notifyTimeOfDay, setNotifyTimeOfDay] = useState(task?.notifyTimeOfDay ?? '');
  const initialRenotify = hoursToRenotifyEveryUnit(task?.renotifyIntervalHours ?? renotifyUnitToHours('day'));
  const [customRenotify, setCustomRenotify] = useState(task?.renotifyIntervalHours != null);
  const [renotifyEvery, setRenotifyEvery] = useState(String(initialRenotify.every));
  const [renotifyUnit, setRenotifyUnit] = useState<RenotifyUnit>(initialRenotify.unit);
  const [syncToCalendar, setSyncToCalendar] = useState<'inherit' | 'yes' | 'no'>(
    task?.syncToCalendar === true ? 'yes' : task?.syncToCalendar === false ? 'no' : 'inherit',
  );
  const createTask = useCreateTask(householdId, boardId);
  const updateTask = useUpdateTask(householdId, boardId);
  const isEditing = task !== undefined;
  const isPending = createTask.isPending || updateTask.isPending;

  const recurrencePreview = recurs ? { every: Math.max(1, Math.trunc(Number(every)) || 1), unit, anchor } : null;

  return (
    <form
      className="task-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '' || dueAt === '') return;
        const renotifyEveryValue = Math.max(1, Math.trunc(Number(renotifyEvery)) || 1);
        const input: CreateTaskInput = {
          title: title.trim(),
          description: description.trim(),
          dueAt: new Date(dueAt).toISOString(),
          recurrence: recurrencePreview,
          leadTimeDays,
          notifyTimeOfDay: notifyTimeOfDay === '' ? null : notifyTimeOfDay,
          renotifyIntervalHours: customRenotify ? renotifyEveryValue * renotifyUnitToHours(renotifyUnit) : null,
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
      <textarea
        className="task-form__description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add more detail (optional)"
        maxLength={2000}
        rows={3}
      />
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
        <input type="checkbox" checked={customRenotify} onChange={(e) => setCustomRenotify(e.target.checked)} />
        Custom reminder frequency
      </label>
      {customRenotify ? (
        <div className="task-form__recur">
          remind every
          <input type="number" min={1} value={renotifyEvery} onChange={(e) => setRenotifyEvery(e.target.value)} />
          <select value={renotifyUnit} onChange={(e) => setRenotifyUnit(e.target.value as RenotifyUnit)}>
            <option value="hour">hour(s)</option>
            <option value="day">day(s)</option>
            <option value="week">week(s)</option>
          </select>
          <span>while still outstanding, starting at the "Notify at" time above</span>
        </div>
      ) : (
        <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
          Reminds every {formatRenotifyInterval(defaultRenotifyIntervalHours(recurrencePreview))} while still outstanding — the default for this recurrence.
        </p>
      )}
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
