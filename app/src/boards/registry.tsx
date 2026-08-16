import type { Board } from '@hhm/shared';
import type { ComponentType } from 'react';

/** The app-side half of the board-type registry (spec §5). `@hhm/shared`'s registry names what a type IS; this one names how it renders. */
export interface BoardTypeUi {
  Card: ComponentType<{ board: Board }>;
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
