import { describe, expect, it } from 'vitest';
import { formatRenotifyInterval } from './recurrence.js';

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
