import type { ThemeColorKey, ThemeColors, ThemePreset } from './schemas.js';

/**
 * `light` is `theme/theme.css`'s `:root` block, copied verbatim — it must
 * stay in sync with that file by hand, since CSS can't import from here and
 * this can't import from CSS. Every other stylesheet keeps working
 * unmodified for anyone who never touches theming: `theme.css`'s `:root`
 * remains the real default, this is only consulted once someone actually
 * has a `Theme` on their profile or device to resolve.
 */
export const THEME_PRESET_COLORS: Record<ThemePreset, ThemeColors> = {
  light: {
    bg: '#f7f5f1',
    surface: '#ffffff',
    'surface-raised': '#ffffff',
    'surface-sunken': '#f0ede6',
    text: '#211f1c',
    'text-soft': '#706a5d',
    'text-inverse': '#ffffff',
    border: '#e4dfd3',
    'border-strong': '#211f1c',
    accent: '#3f7d6b',
    'accent-hover': '#2f5f51',
    'accent-soft': '#e6f1ec',
    'accent-ink': '#ffffff',
    warning: '#9a6b16',
    'warning-soft': '#fdf1d9',
    'warning-border': '#f0d48a',
    danger: '#b3413a',
    'danger-soft': '#fbeae8',
  },
  dark: {
    bg: '#14171a',
    surface: '#1c2023',
    'surface-raised': '#22262a',
    'surface-sunken': '#0f1214',
    text: '#e8e6e1',
    'text-soft': '#a3a099',
    'text-inverse': '#14171a',
    border: '#2c3134',
    'border-strong': '#e8e6e1',
    accent: '#5fb79a',
    'accent-hover': '#7bcab0',
    'accent-soft': '#1e3b33',
    'accent-ink': '#0d1210',
    warning: '#e0ad5a',
    'warning-soft': '#3a2f16',
    'warning-border': '#6b5323',
    danger: '#e2726a',
    'danger-soft': '#3a1e1c',
  },
  colorful: {
    bg: '#f3ecff',
    surface: '#ffffff',
    'surface-raised': '#ffffff',
    'surface-sunken': '#ece0fb',
    text: '#241b3a',
    'text-soft': '#6b5b95',
    'text-inverse': '#ffffff',
    border: '#d9c6f5',
    'border-strong': '#241b3a',
    accent: '#7c3aed',
    'accent-hover': '#6423d1',
    'accent-soft': '#ece1fd',
    'accent-ink': '#ffffff',
    warning: '#d97706',
    'warning-soft': '#fef1dc',
    'warning-border': '#fbd38d',
    danger: '#dc2626',
    'danger-soft': '#fde3e2',
  },
};

export const THEME_PRESET_LABELS: Record<ThemePreset, string> = {
  light: 'Light',
  dark: 'Dark',
  colorful: 'Colorful',
};

export const THEME_COLOR_LABELS: Record<ThemeColorKey, string> = {
  bg: 'Page background',
  surface: 'Card surface',
  'surface-raised': 'Raised surface',
  'surface-sunken': 'Sunken surface',
  text: 'Text',
  'text-soft': 'Soft text',
  'text-inverse': 'Text on accent',
  border: 'Border',
  'border-strong': 'Strong border',
  accent: 'Accent',
  'accent-hover': 'Accent (hover)',
  'accent-soft': 'Accent, soft',
  'accent-ink': 'Text on accent fill',
  warning: 'Warning',
  'warning-soft': 'Warning, soft',
  'warning-border': 'Warning border',
  danger: 'Danger',
  'danger-soft': 'Danger, soft',
};
