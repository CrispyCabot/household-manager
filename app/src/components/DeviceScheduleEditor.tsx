import { DEFAULT_SCHEDULE } from '@hhm/shared';
import type { ScheduleMode, ScheduleRule } from '@hhm/shared';
import { useState } from 'react';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MODES: { value: ScheduleMode; label: string }[] = [
  { value: 'on', label: 'Active' },
  { value: 'screensaver', label: 'Screensaver' },
  { value: 'off', label: 'Asleep' },
];

const ALWAYS_ON: ScheduleRule[] = [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', mode: 'on' }];

function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
}

function RuleRow({ rule, onChange, onRemove }: { rule: ScheduleRule; onChange: (rule: ScheduleRule) => void; onRemove: () => void }) {
  return (
    <div className="schedule-rule">
      <div className="schedule-rule__days">
        {DAY_LABELS.map((label, day) => (
          <button
            key={day}
            type="button"
            className={rule.days.includes(day) ? 'schedule-day schedule-day--active' : 'schedule-day'}
            onClick={() => onChange({ ...rule, days: toggleDay(rule.days, day) })}
            aria-pressed={rule.days.includes(day)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="schedule-rule__fields">
        <input type="time" value={rule.from} onChange={(e) => onChange({ ...rule, from: e.target.value })} />
        <span>to</span>
        <input type="time" value={rule.to} onChange={(e) => onChange({ ...rule, to: e.target.value })} />
        <select value={rule.mode} onChange={(e) => onChange({ ...rule, mode: e.target.value as ScheduleMode })}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn-small" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

/**
 * Edits a device's weekly schedule (FEATURE_ANALYSIS.md's Phase 1 "Schedule
 * model") — a rule list, first match wins, no match defaults to `'on'`
 * (`evaluateSchedule` in `@hhm/shared`). A midnight-crossing window (e.g.
 * `22:00`-`06:30`) is a single rule here, not two — the evaluator handles
 * the crossing.
 */
export function DeviceScheduleEditor({
  schedule,
  onSave,
  saving,
}: {
  schedule: ScheduleRule[];
  onSave: (schedule: ScheduleRule[]) => void;
  saving: boolean;
}) {
  const [rules, setRules] = useState<ScheduleRule[]>(schedule);
  const dirty = JSON.stringify(rules) !== JSON.stringify(schedule);

  return (
    <div className="schedule-editor">
      {rules.map((rule, i) => (
        <RuleRow
          key={i}
          rule={rule}
          onChange={(next) => setRules(rules.map((r, j) => (j === i ? next : r)))}
          onRemove={() => setRules(rules.filter((_, j) => j !== i))}
        />
      ))}
      <div className="schedule-editor__actions">
        <button type="button" className="btn-small" onClick={() => setRules([...rules, { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00', mode: 'on' }])}>
          Add rule
        </button>
        <button type="button" className="btn-small" onClick={() => setRules(DEFAULT_SCHEDULE)}>
          Reset to default
        </button>
        <button type="button" className="btn-small" onClick={() => setRules(ALWAYS_ON)}>
          Always on
        </button>
        <span className="schedule-editor__spacer" />
        <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => onSave(rules)}>
          Save schedule
        </button>
      </div>
    </div>
  );
}
