import { dehydrate, hydrate, useQueryClient } from '@tanstack/react-query';
import type { DehydratedState, Query, QueryClient, QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

const STORAGE_KEY = 'hhm.boardCache.v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 1_000;
const BOARD_DATA = new Set(['tasks', 'items', 'doc', 'link', 'events']);

interface Snapshot {
  owner: string;
  savedAt: number;
  state: DehydratedState;
}

let client: QueryClient | null = null;
let owner: string | null = null;
let restored = false;
let unsubscribe: (() => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function isCachedQueryKey(key: QueryKey): boolean {
  if (key[0] === 'me') return true;
  if (key[0] !== 'households') return false;
  if (key.length === 1) return true;
  if (key[2] === 'boards' && key.length === 3) return true;
  if (key[2] === 'alerts' && key.length === 3) return true;
  return key[2] === 'boards' && BOARD_DATA.has(String(key[4])) && key.at(-1) !== 'audit';
}

function removeSnapshot() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const snapshot = JSON.parse(raw) as Snapshot;
    if (Date.now() - snapshot.savedAt > MAX_AGE_MS) {
      removeSnapshot();
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function save() {
  if (client === null || owner === null) return;
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query: Query) => query.state.status === 'success' && isCachedQueryKey(query.queryKey),
  });
  const snapshot: Snapshot = { owner, savedAt: Date.now(), state };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    removeSnapshot();
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

export function restoreBoardCache(queryClient: QueryClient) {
  client = queryClient;
  const snapshot = readSnapshot();
  if (snapshot === null) return;
  hydrate(queryClient, snapshot.state);
  owner = snapshot.owner;
  restored = true;
}

export function hasRestoredBoardCache(): boolean {
  return restored;
}

function startSaving(sub: string) {
  owner = sub;
  if (unsubscribe === null && client !== null) {
    unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' || event.type === 'removed') scheduleSave();
    });
  }
  scheduleSave();
}

function forget() {
  unsubscribe?.();
  unsubscribe = null;
  clearTimeout(saveTimer);
  owner = null;
  restored = false;
  removeSnapshot();
}

export function clearBoardCache() {
  forget();
  client?.clear();
}

export function useBoardCacheSession(sub: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (sub === null) return;
    if (owner !== null && owner !== sub) {
      forget();
      void queryClient.resetQueries();
    }
    startSaving(sub);
  }, [sub, queryClient]);
}
