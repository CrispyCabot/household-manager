import { describe, expect, it } from 'vitest';
import { normalizeTextPhone } from './schemas.js';

describe('normalizeTextPhone', () => {
  it('accepts a 10 digit number in any common format', () => {
    expect(normalizeTextPhone('(859) 555-0123')).toBe('+18595550123');
    expect(normalizeTextPhone('859.555.0123')).toBe('+18595550123');
  });

  it('accepts a leading country code', () => {
    expect(normalizeTextPhone('+1 859 555 0123')).toBe('+18595550123');
    expect(normalizeTextPhone('18595550123')).toBe('+18595550123');
  });

  it('rejects numbers that are not US or Canadian', () => {
    expect(normalizeTextPhone('+44 20 7946 0958')).toBeNull();
    expect(normalizeTextPhone('555-0123')).toBeNull();
    expect(normalizeTextPhone('(059) 555-0123')).toBeNull();
  });
});
