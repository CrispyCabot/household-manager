import { describe, expect, it } from 'vitest';
import { THEME_PRESET_COLORS } from './presets.js';
import { resolveThemeColors } from './resolve.js';

describe('resolveThemeColors', () => {
  it('resolves null to the light preset with no overrides', () => {
    expect(resolveThemeColors(null)).toEqual(THEME_PRESET_COLORS.light);
  });

  it('resolves undefined the same as null', () => {
    expect(resolveThemeColors(undefined)).toEqual(THEME_PRESET_COLORS.light);
  });

  it('resolves a bare preset to that preset\'s colors verbatim', () => {
    expect(resolveThemeColors({ preset: 'dark', overrides: {} })).toEqual(THEME_PRESET_COLORS.dark);
  });

  it('layers overrides on top of the selected preset, leaving the rest untouched', () => {
    const resolved = resolveThemeColors({ preset: 'colorful', overrides: { accent: '#123456' } });
    expect(resolved.accent).toBe('#123456');
    expect(resolved.bg).toBe(THEME_PRESET_COLORS.colorful.bg);
  });

  it('switching preset keeps overrides in effect', () => {
    const resolved = resolveThemeColors({ preset: 'dark', overrides: { accent: '#123456' } });
    expect(resolved.accent).toBe('#123456');
    expect(resolved.bg).toBe(THEME_PRESET_COLORS.dark.bg);
  });
});
