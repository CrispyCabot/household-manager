import { z } from 'zod';

export const THEME_PRESETS = ['light', 'dark', 'lightPurple', 'darkPurple'] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

/** Light purple was called `colorful` before it was renamed; themes saved under that name still load as it. */
export const ThemePresetSchema = z
  .enum([...THEME_PRESETS, 'colorful'])
  .transform((preset): ThemePreset => (preset === 'colorful' ? 'lightPurple' : preset));

export function themePresetOf(value: unknown): ThemePreset {
  const parsed = ThemePresetSchema.safeParse(value);
  return parsed.success ? parsed.data : 'light';
}

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Expected a 6-digit hex color, e.g. #3f7d6b');

/**
 * Every colour token `theme/theme.css` defines, minus the non-colour ones
 * (fonts, radii, shadows, gap) — those aren't part of "customize each
 * individual color". Keys match the CSS custom property name verbatim
 * (minus the `--`), so applying a resolved `ThemeColors` is a direct
 * `--${key}: value` loop with no name-mapping table to keep in sync.
 */
export const ThemeColorsSchema = z.object({
  bg: hex,
  surface: hex,
  'surface-raised': hex,
  'surface-sunken': hex,
  text: hex,
  'text-soft': hex,
  'text-inverse': hex,
  border: hex,
  'border-strong': hex,
  accent: hex,
  'accent-hover': hex,
  'accent-soft': hex,
  'accent-ink': hex,
  warning: hex,
  'warning-soft': hex,
  'warning-border': hex,
  danger: hex,
  'danger-soft': hex,
});
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;
export type ThemeColorKey = keyof ThemeColors;

/** Derived from the schema, not hand-maintained, so the two can never drift apart. */
export const THEME_COLOR_KEYS = Object.keys(ThemeColorsSchema.shape) as ThemeColorKey[];

/**
 * A theme is a built-in preset plus any number of individually-overridden
 * colors on top of it — this is what lets "pick a preset" and
 * "customize each individual color" be the same feature instead of two:
 * every override is optional, so a theme with none is just its preset
 * verbatim, and switching `preset` never discards overrides made while a
 * different preset was selected.
 */
export const ThemeSchema = z.object({
  preset: ThemePresetSchema,
  overrides: ThemeColorsSchema.partial(),
});
export type Theme = z.infer<typeof ThemeSchema>;

export function themeOf(value: unknown): Theme | null {
  const parsed = ThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
