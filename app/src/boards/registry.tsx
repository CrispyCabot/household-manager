import type { Board } from '@hhm/shared';
import type { ComponentType } from 'react';

/** The app-side half of the board-type registry (spec §5). `@hhm/shared`'s registry names what a type IS; this one names how it renders. */
export interface BoardTypeUi {
  /**
   * `size` is only ever set on a dashboard using a custom layout
   * (FEATURE_ANALYSIS.md's Phase 4, `DashboardLayoutEditor`) — grid cells,
   * not pixels. Every board type's Card must render sensibly without it
   * (the default `.cardgrid` flow never passes it), and may optionally use
   * it to show more when a tile is bigger than its default footprint.
   */
  Card: ComponentType<{ board: Board; size?: { w: number; h: number } }>;
  Page: ComponentType<{ board: Board }>;
}

const registry = new Map<string, BoardTypeUi>();

/** Called once per board type's own module — e.g. `boards/tasks/index.tsx` in phase 2. Never called from here. */
export function registerBoardTypeUi(type: string, ui: BoardTypeUi): void {
  registry.set(type, ui);
}

export function boardTypeUi(type: string): BoardTypeUi | undefined {
  return registry.get(type);
}
