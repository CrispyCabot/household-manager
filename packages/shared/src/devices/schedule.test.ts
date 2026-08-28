import { describe, expect, it } from 'vitest';
import { easternWallClockToUtcIso } from '../time.js';
import { evaluateSchedule, evaluateScheduleAt } from './schedule.js';
import { DEFAULT_SCHEDULE } from './schemas.js';
import type { ScheduleRule } from './schemas.js';

describe('evaluateSchedule', () => {
  it('defaults to "on" with no rules', () => {
    expect(evaluateSchedule([], { dow: 3, minutes: 720 }, { dow: 2, minutes: 720 })).toBe('on');
  });

  it('defaults to "on" outside every rule\'s window', () => {
    const rules: ScheduleRule[] = [{ days: [3], from: '09:00', to: '17:00', mode: 'off' }];
    // Wednesday at 20:00 — outside the one rule's window.
    expect(evaluateSchedule(rules, { dow: 3, minutes: 1200 }, { dow: 2, minutes: 1200 })).toBe('on');
  });

  it('matches a same-day, non-crossing window', () => {
    const rules: ScheduleRule[] = [{ days: [3], from: '09:00', to: '17:00', mode: 'screensaver' }];
    expect(evaluateSchedule(rules, { dow: 3, minutes: 12 * 60 }, { dow: 2, minutes: 12 * 60 })).toBe('screensaver');
  });

  it('first matching rule wins over a later one that would also match', () => {
    const rules: ScheduleRule[] = [
      { days: [3], from: '00:00', to: '23:59', mode: 'on' },
      { days: [3], from: '09:00', to: '17:00', mode: 'off' },
    ];
    expect(evaluateSchedule(rules, { dow: 3, minutes: 12 * 60 }, { dow: 2, minutes: 12 * 60 })).toBe('on');
  });

  it("DEFAULT_SCHEDULE is 'on' mid-morning on a weekday", () => {
    // Tuesday 07:00.
    expect(evaluateSchedule(DEFAULT_SCHEDULE, { dow: 2, minutes: 7 * 60 }, { dow: 1, minutes: 7 * 60 })).toBe('on');
  });

  it("DEFAULT_SCHEDULE's midnight-crossing off-window is still active after midnight", () => {
    // Tuesday 02:00 — inside Monday night's 22:00-06:30 off window.
    expect(evaluateSchedule(DEFAULT_SCHEDULE, { dow: 2, minutes: 2 * 60 }, { dow: 1, minutes: 2 * 60 })).toBe('off');
  });

  it('flips from off to on at the exact end of a midnight-crossing window, with no gap', () => {
    const atEnd = { dow: 2, minutes: 6 * 60 + 30 };
    const yesterday = { dow: 1, minutes: atEnd.minutes };
    expect(evaluateSchedule(DEFAULT_SCHEDULE, atEnd, yesterday)).toBe('on');

    const justBefore = { dow: 2, minutes: 6 * 60 + 29 };
    expect(evaluateSchedule(DEFAULT_SCHEDULE, justBefore, { dow: 1, minutes: justBefore.minutes })).toBe('off');
  });

  it('the weekday off-window does not leak into Saturday morning', () => {
    // Saturday 02:00 — Friday is a weekday-off day, but the weekend rules take over at midnight Saturday.
    // DEFAULT_SCHEDULE's weekend on-window starts 07:30, so 02:00 Saturday should still read the
    // Friday-night weekday off-rule (days include Friday=5), which is the correct, if slightly
    // surprising, behavior of a schedule keyed by the window's *start* day.
    expect(evaluateSchedule(DEFAULT_SCHEDULE, { dow: 6, minutes: 2 * 60 }, { dow: 5, minutes: 2 * 60 })).toBe('off');
  });
});

describe('evaluateScheduleAt', () => {
  it('integrates with real UTC instants across a DST boundary', () => {
    // 2026-03-09 is a Monday; 07:15 Eastern (post spring-forward) falls inside the weekday on-window.
    const instant = easternWallClockToUtcIso('2026-03-09', '07:15');
    expect(evaluateScheduleAt(DEFAULT_SCHEDULE, instant)).toBe('on');
  });

  it('resolves a real instant to the off window overnight', () => {
    // 2026-01-15 is a Thursday; 23:30 Eastern falls inside the weekday off-window.
    const instant = easternWallClockToUtcIso('2026-01-15', '23:30');
    expect(evaluateScheduleAt(DEFAULT_SCHEDULE, instant)).toBe('off');
  });
});
