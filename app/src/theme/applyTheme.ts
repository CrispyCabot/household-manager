import { resolveThemeColors, THEME_COLOR_KEYS } from '@hhm/shared';
import type { Theme } from '@hhm/shared';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

/** Resolves `theme` and turns it into a `--key: value` style object — every key already matches its CSS custom property name (see `@hhm/shared`'s `ThemeColorsSchema`), so this is a direct loop with no name-mapping table. */
export function themeCssVars(theme: Theme | null | undefined): CSSProperties {
  const colors = resolveThemeColors(theme);
  const style: Record<string, string> = {};
  for (const key of THEME_COLOR_KEYS) style[`--${key}`] = colors[key];
  return style as CSSProperties;
}

/**
 * Applies the signed-in user's own theme app-wide, by setting each color
 * variable directly on `<html>` rather than on a wrapper div inside `#root`
 * (compare `components/ThemeScope.tsx`). That distinction matters here
 * specifically because of `body`: `styles.css`'s `body { background:
 * var(--bg) }` resolves against whatever `body` itself inherits, and `body`
 * sits *outside* React's tree entirely — a `display: contents` div under
 * `#root` can never reach it. Setting the variables on `<html>` instead
 * means `body` (and everything else) picks them up through ordinary
 * inheritance, so there's no seam where an unthemed fallback color could
 * show through behind short pages or an overscroll bounce.
 *
 * Used exactly once, in `main.tsx`'s `App`, for the profile theme. The wall
 * dashboard (`routes/Dashboard.tsx`) still uses `ThemeScope` for its own
 * device theme — a *more specific* override nested inside whatever this
 * hook already put on `<html>`, not a competing write to the same node, so
 * the two never race even when both are mounted (a signed-in user who
 * navigates to `/dashboard` in their own browser).
 */
export function useAppTheme(theme: Theme | null | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    const colors = resolveThemeColors(theme);
    for (const key of THEME_COLOR_KEYS) root.style.setProperty(`--${key}`, colors[key]);
    return () => {
      for (const key of THEME_COLOR_KEYS) root.style.removeProperty(`--${key}`);
    };
  }, [theme]);
}
