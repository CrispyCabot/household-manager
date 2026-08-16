import type { Board, CreateHousehold, Household, MeResponse } from '@hhm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.js';
import { apiFetch } from './client.js';

/** The bearer token, or null while the session is still being restored. Never throws — see Poster Walls Editor's identical pattern. */
function useToken(): string | null {
  return useAuth().bearerToken;
}

function required(token: string | null): string {
  if (token === null) throw new Error('Not signed in');
  return token;
}

export const queryKeys = {
  me: ['me'] as const,
  households: ['households'] as const,
  boards: (householdId: string) => ['households', householdId, 'boards'] as const,
};

export function useMe() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.me,
    enabled: token !== null,
    queryFn: () => apiFetch<MeResponse>('/v1/me', token!),
  });
}

export function useSetLastHousehold() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (householdId: string) =>
      apiFetch<void>('/v1/me/last-household', required(token), {
        method: 'PUT',
        body: JSON.stringify({ householdId }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useHouseholds() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.households,
    enabled: token !== null,
    queryFn: () => apiFetch<{ households: Household[] }>('/v1/households', token!),
  });
}

export function useCreateHousehold() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHousehold) =>
      apiFetch<{ household: Household }>('/v1/households', required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.households });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useDeleteHousehold() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (householdId: string) =>
      apiFetch<void>(`/v1/households/${householdId}`, required(token), { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.households });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useBoards(householdId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.boards(householdId ?? ''),
    enabled: token !== null && householdId !== null,
    queryFn: () => apiFetch<{ boards: Board[] }>(`/v1/households/${householdId}/boards`, token!),
  });
}

export function useCreateBoard(householdId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; title: string }) =>
      apiFetch<{ board: Board }>(`/v1/households/${householdId}/boards`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.boards(householdId) }),
  });
}
