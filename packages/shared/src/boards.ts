import type { z } from 'zod';

export interface BoardTypeDefinition {
  readonly id: string;
  readonly displayName: string;
  /** A short label used as a fallback icon — an emoji, e.g. "✅". */
  readonly icon: string;
  readonly configSchema: z.ZodTypeAny;
}

const registry = new Map<string, BoardTypeDefinition>();

/**
 * Called once per board type, at module load, by that type's own module —
 * e.g. `boards/tasks.ts` in phase 2. The core never imports a specific
 * board type; only `index.ts` decides which type modules are loaded at all.
 */
export function registerBoardType(def: BoardTypeDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`board type "${def.id}" is already registered`);
  }
  registry.set(def.id, def);
}

export function boardType(id: string): BoardTypeDefinition | undefined {
  return registry.get(id);
}

export function boardTypeIds(): string[] {
  return [...registry.keys()];
}
