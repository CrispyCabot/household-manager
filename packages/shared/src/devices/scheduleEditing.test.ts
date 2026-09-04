import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULE } from './schemas.js';
import { evaluateSchedule } from './schedule.js';
import {
  groupScheduleRules,
  mergeAdjacentSegments,
  minutesToTimeOfDay,
  timeOfDayToMinutes,
  ungroupScheduleRules,
} from './scheduleEditing.js';

describe('timeOfDayToMinutes / minutesToTimeOfDay', () => {
  it('round-trips', () => {
    expect(timeOfDayToMinutes('06:30')).toBe(390);
    expect(minutesToTimeOfDay(390)).toBe('06:30');
    expect(minutesToTimeOfDay(1440)).toBe('00:00');
  });
});

describe('mergeAdjacentSegments', () => {
  it('drops a boundary whose segment matches the mode before it', () => {
    const merged = mergeAdjacentSegments([
      { startMin: 0, mode: 'off' },
      { startMin: 60, mode: 'off' },
      { startMin: 120, mode: 'on' },
    ]);
    expect(merged).toEqual([
      { startMin: 0, mode: 'off' },
      { startMin: 120, mode: 'on' },
    ]);
  });

  it('keeps distinct-mode segments untouched', () => {
    const segments = [
      { startMin: 0, mode: 'off' as const },
      { startMin: 60, mode: 'on' as const },
    ];
    expect(mergeAdjacentSegments(segments)).toEqual(segments);
  });
});

describe('groupScheduleRules', () => {
  it("correctly unwraps a midnight-crossing rule into the day's first segment", () => {
    // A weekday-only group: awake 06:30-22:00, asleep 22:00-06:30 (wraps).
    const rules = [
      { days: [1, 2, 3, 4, 5], from: '06:30', to: '22:00', mode: 'on' as const },
      { days: [1, 2, 3, 4, 5], from: '22:00', to: '06:30', mode: 'off' as const },
    ];
    const groups = groupScheduleRules(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.days).toEqual([1, 2, 3, 4, 5]);
    // Must start the day asleep (from the previous night's wrap), not awake.
    expect(groups[0]!.segments).toEqual([
      { startMin: 0, mode: 'off' },
      { startMin: 390, mode: 'on' },
      { startMin: 1320, mode: 'off' },
    ]);
  });

  it('separates rules into groups by their exact day set', () => {
    const groups = groupScheduleRules(DEFAULT_SCHEDULE);
    expect(groups).toHaveLength(2);
    const weekday = groups.find((g) => g.days.includes(1));
    const weekend = groups.find((g) => g.days.includes(0));
    expect(weekday!.days).toEqual([1, 2, 3, 4, 5]);
    expect(weekend!.days).toEqual([0, 6]);
  });

  it('fills a gap before the first covered minute with "on", matching the evaluator default', () => {
    const groups = groupScheduleRules([{ days: [3], from: '09:00', to: '17:00', mode: 'off' }]);
    expect(groups[0]!.segments[0]).toEqual({ startMin: 0, mode: 'on' });
  });
});

describe('ungroupScheduleRules', () => {
  it('is the inverse of groupScheduleRules for the shipped default schedule', () => {
    const roundTripped = ungroupScheduleRules(groupScheduleRules(DEFAULT_SCHEDULE));
    // Same rule set, not necessarily same array order — compare as a set of stringified rules.
    const normalize = (rules: typeof DEFAULT_SCHEDULE) => rules.map((r) => JSON.stringify(r)).sort();
    expect(normalize(roundTripped)).toEqual(normalize(DEFAULT_SCHEDULE));
  });

  it('produces rules that evaluate identically to the original schedule at every hour of the week', () => {
    const roundTripped = ungroupScheduleRules(groupScheduleRules(DEFAULT_SCHEDULE));
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const now = { dow, minutes: hour * 60 };
        const yesterday = { dow: (dow + 6) % 7, minutes: hour * 60 };
        expect(evaluateSchedule(roundTripped, now, yesterday)).toBe(evaluateSchedule(DEFAULT_SCHEDULE, now, yesterday));
      }
    }
  });

  it('always emits contiguous segments covering the full 24h, even after an edit', () => {
    const edited = [{ days: [0, 1, 2, 3, 4, 5, 6], segments: [{ startMin: 0, mode: 'on' as const }, { startMin: 500, mode: 'off' as const }] }];
    const rules = ungroupScheduleRules(edited);
    expect(rules).toEqual([
      { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '08:20', mode: 'on' },
      { days: [0, 1, 2, 3, 4, 5, 6], from: '08:20', to: '00:00', mode: 'off' },
    ]);
  });
});
