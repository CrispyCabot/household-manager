import type { Theme } from '@hhm/shared';
import type { ReactNode } from 'react';
import { themeCssVars } from '../theme/applyTheme.js';

/**
 * Applies a resolved theme's colors as CSS custom-property overrides on a
 * layout-transparent wrapper (`display: contents` — see `theme/theme.css`),
 * so descendants pick them up through ordinary CSS variable inheritance
 * without this div taking part in any surrounding flex/grid layout.
 *
 * Nested once per audience: `main.tsx`'s `App` wraps the whole signed-in app
 * with the user's own profile theme, and the wall dashboard
 * (`routes/Dashboard.tsx`) nests a second `ThemeScope` inside with the
 * device's own theme — which simply overrides the inherited variables for
 * just that subtree, so a kiosk's theme is independent of whichever human
 * last touched the settings screen on their phone.
 */
export function ThemeScope({ theme, children }: { theme: Theme | null | undefined; children: ReactNode }) {
  return (
    <div className="theme-scope" style={themeCssVars(theme)}>
      {children}
    </div>
  );
}
