import { describe, expect, it } from 'vitest';
import { formatRenotifyInterval, maxSkippableNotifications, nagStart } from './recurrence.js';

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

describe('maxSkippableNotifications', () => {
  it('caps an hourly cadence at 48 (2 days)', () => {
    expect(maxSkippableNotifications(1)).toBe(48);
  });

  it('caps a daily cadence at 14 (2 weeks)', () => {
    expect(maxSkippableNotifications(24)).toBe(14);
  });

  it('caps a weekly cadence at 4 (~1 month)', () => {
    expect(maxSkippableNotifications(24 * 7)).toBe(4);
  });

  it('keeps every cap comfortably under the 720h snooze ceiling', () => {
    for (const renotifyHours of [1, 24, 24 * 7]) {
      expect(maxSkippableNotifications(renotifyHours) * renotifyHours).toBeLessThanOrEqual(24 * 30);
    }
  });
});
