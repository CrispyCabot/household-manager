import { describe, expect, it } from 'vitest';
import { easternWallClockParts, easternWallClockToUtcIso } from './time.js';

describe('easternWallClockToUtcIso', () => {
  it('converts Eastern midnight during EST (UTC-5)', () => {
    expect(easternWallClockToUtcIso('2026-01-15', '00:00')).toBe('2026-01-15T05:00:00.000Z');
  });

  it('converts Eastern midnight during EDT (UTC-4)', () => {
    expect(easternWallClockToUtcIso('2026-07-15', '00:00')).toBe('2026-07-15T04:00:00.000Z');
  });

  it('converts a non-midnight time of day', () => {
    expect(easternWallClockToUtcIso('2026-07-15', '14:30')).toBe('2026-07-15T18:30:00.000Z');
  });

  it('converts the day after a fall-back transition', () => {
    // DST ends 2026-11-01 in the US; by 2026-11-02 the zone is back to EST (UTC-5).
    expect(easternWallClockToUtcIso('2026-11-02', '00:00')).toBe('2026-11-02T05:00:00.000Z');
  });

  it('converts the day after a spring-forward transition', () => {
    // DST starts 2026-03-08 in the US; by 2026-03-09 the zone is EDT (UTC-4).
    expect(easternWallClockToUtcIso('2026-03-09', '00:00')).toBe('2026-03-09T04:00:00.000Z');
  });
});

describe('easternWallClockParts', () => {
  it('reads day-of-week and minute-of-day during EST (UTC-5)', () => {
    // 2026-01-15T05:00:00Z is Thursday 00:00 Eastern.
    expect(easternWallClockParts('2026-01-15T05:00:00.000Z')).toEqual({ dow: 4, minutes: 0 });
  });

  it('reads day-of-week and minute-of-day during EDT (UTC-4)', () => {
    // 2026-07-15T18:30:00Z is Wednesday 14:30 Eastern.
    expect(easternWallClockParts('2026-07-15T18:30:00.000Z')).toEqual({ dow: 3, minutes: 14 * 60 + 30 });
  });

  it('round-trips through easternWallClockToUtcIso across a DST boundary', () => {
    const utcIso = easternWallClockToUtcIso('2026-03-09', '07:15');
    expect(easternWallClockParts(utcIso)).toEqual({ dow: 1, minutes: 7 * 60 + 15 });
  });

  it('rolls over into Sunday just after Saturday midnight', () => {
    // 2026-01-18 is a Sunday; 00:05 Eastern during EST is 05:05Z.
    expect(easternWallClockParts('2026-01-18T05:05:00.000Z')).toEqual({ dow: 0, minutes: 5 });
  });
});
