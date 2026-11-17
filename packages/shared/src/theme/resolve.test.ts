import { describe, expect, it } from 'vitest';
import { THEME_PRESET_COLORS } from './presets.js';
import { resolveThemeColors } from './resolve.js';
import { ThemeSchema, themeOf } from './schemas.js';

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
    const resolved = resolveThemeColors({ preset: 'lightPurple', overrides: { accent: '#123456' } });
    expect(resolved.accent).toBe('#123456');
    expect(resolved.bg).toBe(THEME_PRESET_COLORS.lightPurple.bg);
  });

  it('switching preset keeps overrides in effect', () => {
    const resolved = resolveThemeColors({ preset: 'dark', overrides: { accent: '#123456' } });
    expect(resolved.accent).toBe('#123456');
    expect(resolved.bg).toBe(THEME_PRESET_COLORS.dark.bg);
  });

  it('resolves a theme cached under the old colorful name as light purple', () => {
    expect(resolveThemeColors({ preset: 'colorful', overrides: {} } as never)).toEqual(THEME_PRESET_COLORS.lightPurple);
  });
});

describe('ThemeSchema', () => {
  it('reads a theme saved as colorful as light purple', () => {
    expect(ThemeSchema.parse({ preset: 'colorful', overrides: { accent: '#123456' } })).toEqual({
      preset: 'lightPurple',
      overrides: { accent: '#123456' },
    });
  });

  it('accepts dark purple', () => {
    expect(ThemeSchema.parse({ preset: 'darkPurple', overrides: {} }).preset).toBe('darkPurple');
  });
});

describe('themeOf', () => {
  it('drops a stored value that is not a theme', () => {
    expect(themeOf({ preset: 'neon', overrides: {} })).toBeNull();
    expect(themeOf(undefined)).toBeNull();
  });
});
