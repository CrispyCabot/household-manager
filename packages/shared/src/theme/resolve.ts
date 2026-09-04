import { THEME_PRESET_COLORS } from './presets.js';
import { THEME_COLOR_KEYS } from './schemas.js';
import type { Theme, ThemeColors } from './schemas.js';

/**
 * `null`/`undefined` (never customized) resolves identically to an explicit
 * `{ preset: 'light', overrides: {} }` — callers never need to special-case
 * "no theme set" separately from "the light preset, untouched".
 */
export function resolveThemeColors(theme: Theme | null | undefined): ThemeColors {
  const base = THEME_PRESET_COLORS[theme?.preset ?? 'light'];
  if (theme === null || theme === undefined) return base;
  const resolved = { ...base };
  for (const key of THEME_COLOR_KEYS) {
    const override = theme.overrides[key];
    if (override !== undefined) resolved[key] = override;
  }
  return resolved;
}
