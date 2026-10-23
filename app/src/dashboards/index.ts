import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';

/**
 * A bespoke look for one specific wall dashboard. Everything about it lives
 * in its own folder under `app/src/dashboards/` — see README.md there.
 */
export interface CustomDashboard {
  /**
   * Set as `data-dashboard` on `<html>` while this dashboard is on screen.
   * Every selector in the dashboard's stylesheet starts with
   * `html[data-dashboard='<slug>']`, so none of it can reach anything else.
   */
  slug: string;
  /** An optional decorative layer drawn behind the dashboard's content. */
  Backdrop?: ComponentType;
}

/**
 * Device id → its custom dashboard, loaded on demand: each one is its own
 * code-split chunk (JS and CSS), so no other device or page ever downloads it.
 */
const CUSTOM_DASHBOARDS: Record<string, () => Promise<{ default: CustomDashboard }>> = {
  // Kitchen Wall
  '7d9eec8e-ad2e-4a3a-9b8f-e391057336cd': () => import('./kitchen-wall/index.js'),
};

/** The custom dashboard for `deviceId`, once loaded — `null` for a device without one. */
export function useCustomDashboard(deviceId: string | undefined): CustomDashboard | null {
  const [custom, setCustom] = useState<CustomDashboard | null>(null);

  useEffect(() => {
    const load = deviceId === undefined ? undefined : CUSTOM_DASHBOARDS[deviceId];
    setCustom(null);
    if (load === undefined) return;
    let cancelled = false;
    load()
      .then((module) => {
        if (!cancelled) setCustom(module.default);
      })
      .catch(() => {
        // A failed chunk load just means the stock look — never a broken dashboard.
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (custom === null) return;
    const root = document.documentElement;
    root.dataset.dashboard = custom.slug;
    return () => {
      delete root.dataset.dashboard;
    };
  }, [custom]);

  return custom;
}
