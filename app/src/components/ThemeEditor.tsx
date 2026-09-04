import {
  resolveThemeColors,
  THEME_COLOR_KEYS,
  THEME_COLOR_LABELS,
  THEME_PRESET_LABELS,
  THEME_PRESETS,
} from '@hhm/shared';
import type { Theme, ThemeColorKey, ThemePreset } from '@hhm/shared';
import { useState } from 'react';

const EMPTY_THEME: Theme = { preset: 'light', overrides: {} };

/** `Theme['overrides']`, not TS's `Partial<ThemeColors>` — zod's own `.partial()` inference is what every `Theme` value actually carries, and it isn't structurally identical to TS's `Partial<>` under `exactOptionalPropertyTypes`. */
type ThemeOverrides = Theme['overrides'];

/**
 * A preset picker plus one color swatch per token — "a selection of default
 * themes" and "customize each individual color" are the same control here,
 * not two: every override sits on top of whichever preset is selected, so
 * switching presets never discards a color someone already customized (see
 * `@hhm/shared`'s `resolveThemeColors`).
 */
export function ThemeEditor({
  theme,
  onSave,
  saving,
}: {
  theme: Theme | null;
  onSave: (theme: Theme) => void;
  saving: boolean;
}) {
  const initial = theme ?? EMPTY_THEME;
  const [preset, setPreset] = useState<ThemePreset>(initial.preset);
  const [overrides, setOverrides] = useState<ThemeOverrides>(initial.overrides);

  const resolved = resolveThemeColors({ preset, overrides });
  const dirty = preset !== initial.preset || JSON.stringify(overrides) !== JSON.stringify(initial.overrides);

  function setColor(key: ThemeColorKey, value: string) {
    setOverrides((prev) => {
      const next: ThemeOverrides = { ...prev };
      next[key] = value;
      return next;
    });
  }

  function resetColor(key: ThemeColorKey) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  return (
    <div className="theme-editor">
      <div className="theme-editor__presets">
        {THEME_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={p === preset ? 'btn-small theme-preset-btn theme-preset-btn--active' : 'btn-small theme-preset-btn'}
            onClick={() => setPreset(p)}
            aria-pressed={p === preset}
          >
            {THEME_PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="theme-editor__swatches">
        {THEME_COLOR_KEYS.map((key) => (
          <div key={key} className="theme-swatch">
            <input
              type="color"
              value={resolved[key]}
              onChange={(e) => setColor(key, e.target.value)}
              aria-label={THEME_COLOR_LABELS[key]}
            />
            <span className="theme-swatch__label">{THEME_COLOR_LABELS[key]}</span>
            {overrides[key] !== undefined && (
              <button type="button" className="theme-swatch__reset" onClick={() => resetColor(key)}>
                Reset
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="theme-editor__actions">
        <button type="button" className="btn-small" onClick={() => setOverrides({})}>
          Reset all to preset
        </button>
        <span className="theme-editor__spacer" />
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || saving}
          onClick={() => onSave({ preset, overrides })}
        >
          Save theme
        </button>
      </div>
    </div>
  );
}
