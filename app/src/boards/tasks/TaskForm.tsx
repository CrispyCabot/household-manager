import { useState } from 'react';
import type { CreateTaskInput, RecurrenceUnit } from '@hhm/shared';
import { useCreateTask } from '../../api/queries.js';

export function TaskForm({ householdId, boardId }: { householdId: string; boardId: string }) {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [recurs, setRecurs] = useState(false);
  const [every, setEvery] = useState(1);
  const [unit, setUnit] = useState<RecurrenceUnit>('month');
  const [anchor, setAnchor] = useState<'completion' | 'schedule'>('completion');
  const [leadTimeDays, setLeadTimeDays] = useState(0);
  const createTask = useCreateTask(householdId, boardId);

  return (
    <form
      className="task-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() === '' || dueAt === '') return;
        const input: CreateTaskInput = {
          title: title.trim(),
          description: '',
          dueAt: new Date(dueAt).toISOString(),
          recurrence: recurs ? { every, unit, anchor } : null,
          leadTimeDays,
          notify: { inApp: true, email: true },
        };
        createTask.mutate(input, {
          onSuccess: () => {
            setTitle('');
            setDueAt('');
          },
        });
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Clean the dog" />
      <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      <label>
        <input type="checkbox" checked={recurs} onChange={(e) => setRecurs(e.target.checked)} />
        Repeats
      </label>
      {recurs && (
        <div className="task-form__recur">
          every
          <input
            type="number"
            min={1}
            value={every}
            onChange={(e) => setEvery(Math.max(1, Number(e.target.value)))}
          />
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
      <label>
        Start nagging
        <input
          type="number"
          min={0}
          value={leadTimeDays}
          onChange={(e) => setLeadTimeDays(Math.max(0, Number(e.target.value)))}
        />
        days early
      </label>
      <button type="submit" className="btn-primary" disabled={createTask.isPending}>
        Add task
      </button>
    </form>
  );
}
