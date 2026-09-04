import { describe, expect, it } from 'vitest';
import { defaultRenotifyIntervalHours, effectiveRenotifyIntervalHours, formatDurationHours, formatRenotifyInterval, nagStart } from './recurrence.js';

describe('formatRenotifyInterval', () => {
  it('formats a single hour', () => {
    expect(formatRenotifyInterval(1)).toBe('1 hour');
  });

  it('formats a single day', () => {
    expect(formatRenotifyInterval(24)).toBe('1 day');
  });

  it('formats a single week', () => {
    expect(formatRenotifyInterval(24 * 7)).toBe('1 week');
  });
});

describe('nagStart', () => {
  it('starts at Eastern midnight (EDT) with no lead time and no custom time', () => {
    // A date-only dueAt is stored as UTC midnight for that calendar date (see TaskForm).
    expect(nagStart('2026-08-24T00:00:00.000Z', 0, null)).toBe('2026-08-24T04:00:00.000Z');
  });

  it('starts at Eastern midnight (EST) with no lead time and no custom time', () => {
    expect(nagStart('2026-01-24T00:00:00.000Z', 0, null)).toBe('2026-01-24T05:00:00.000Z');
  });

  it('subtracts whole lead-time days before applying the Eastern time of day', () => {
    expect(nagStart('2026-08-24T00:00:00.000Z', 3, null)).toBe('2026-08-21T04:00:00.000Z');
  });

  it('honors a custom Eastern time of day', () => {
    expect(nagStart('2026-08-24T00:00:00.000Z', 0, '09:30')).toBe('2026-08-24T13:30:00.000Z');
  });
});

describe('defaultRenotifyIntervalHours', () => {
  it('is hourly for day/week recurrence', () => {
    expect(defaultRenotifyIntervalHours({ every: 1, unit: 'day', anchor: 'completion' })).toBe(1);
    expect(defaultRenotifyIntervalHours({ every: 1, unit: 'week', anchor: 'completion' })).toBe(1);
  });

  it('is daily for monthly recurrence', () => {
    expect(defaultRenotifyIntervalHours({ every: 1, unit: 'month', anchor: 'completion' })).toBe(24);
  });

  it('is weekly for yearly recurrence', () => {
    expect(defaultRenotifyIntervalHours({ every: 1, unit: 'year', anchor: 'completion' })).toBe(24 * 7);
  });

  it('falls back to a flat 24h for a non-recurring task', () => {
    expect(defaultRenotifyIntervalHours(null)).toBe(24);
  });
});

describe('effectiveRenotifyIntervalHours', () => {
  it('uses the recurrence-based default when no override is set', () => {
    expect(effectiveRenotifyIntervalHours({ recurrence: { every: 1, unit: 'month', anchor: 'completion' }, renotifyIntervalHours: null })).toBe(24);
  });

  it("uses the task's own override when set, regardless of recurrence", () => {
    expect(effectiveRenotifyIntervalHours({ recurrence: { every: 1, unit: 'month', anchor: 'completion' }, renotifyIntervalHours: 1 })).toBe(1);
  });
});

describe('formatDurationHours', () => {
  it('formats a duration under a day as hours only', () => {
    expect(formatDurationHours(5)).toBe('5 hours');
    expect(formatDurationHours(1)).toBe('1 hour');
  });

  it('formats a duration on an exact day boundary as days only', () => {
    expect(formatDurationHours(48)).toBe('2 days');
    expect(formatDurationHours(24)).toBe('1 day');
  });

  it('formats a mixed duration as days and hours', () => {
    expect(formatDurationHours(76)).toBe('3 days, 4 hours');
    expect(formatDurationHours(25)).toBe('1 day, 1 hour');
  });
});
