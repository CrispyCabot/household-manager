import type {
  Board,
  ChecklistItem,
  CreateChecklistItemInput,
  CreateHousehold,
  CreateInviteInput,
  CreateTaskInput,
  Household,
  Invite,
  LinkDoc,
  LinkIcon,
  Member,
  MeResponse,
  SnoozeTaskInput,
  Task,
  TextBlock,
  TextDoc,
  UpdateChecklistItemInput,
  UpdateHousehold,
  UpdateTaskInput,
} from '@hhm/shared';
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
  members: (householdId: string) => ['households', householdId, 'members'] as const,
  invites: (householdId: string) => ['households', householdId, 'invites'] as const,
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

export function useUpdateHousehold(householdId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateHousehold) =>
      apiFetch<{ household: Household }>(`/v1/households/${householdId}`, required(token), {
        method: 'PATCH',
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

export function useReorderBoards(householdId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (boardIds: string[]) =>
      apiFetch<{ boards: Board[] }>(`/v1/households/${householdId}/boards/order`, required(token), {
        method: 'PUT',
        body: JSON.stringify({ boardIds }),
      }),
    onMutate: async (boardIds: string[]) => {
      await qc.cancelQueries({ queryKey: queryKeys.boards(householdId) });
      const previous = qc.getQueryData<{ boards: Board[] }>(queryKeys.boards(householdId));
      if (previous) {
        const byId = new Map(previous.boards.map((b) => [b.id, b]));
        qc.setQueryData(queryKeys.boards(householdId), {
          boards: boardIds.map((id, position) => ({ ...byId.get(id)!, position })),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.boards(householdId), ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.boards(householdId) }),
  });
}

export function useMembers(householdId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.members(householdId),
    enabled: token !== null,
    queryFn: () => apiFetch<{ members: Member[] }>(`/v1/households/${householdId}/members`, token!),
  });
}

export function useRemoveMember(householdId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sub: string) =>
      apiFetch<void>(`/v1/households/${householdId}/members/${encodeURIComponent(sub)}`, required(token), { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members(householdId) });
      // A member removing themselves is "leaving" (same endpoint, see the
      // API's own comment) — that drops the household from this user's own
      // list/switcher too, whether it was self-removal or not.
      void qc.invalidateQueries({ queryKey: queryKeys.households });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useInvites(householdId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.invites(householdId),
    enabled: token !== null,
    queryFn: () => apiFetch<{ invites: Invite[] }>(`/v1/households/${householdId}/invites`, token!),
  });
}

export function useCreateInvite(householdId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      apiFetch<{ invite: Invite }>(`/v1/households/${householdId}/invites`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.invites(householdId) }),
  });
}

export function useRevokeInvite(householdId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<void>(`/v1/households/${householdId}/invites/${encodeURIComponent(email)}`, required(token), { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.invites(householdId) }),
  });
}

export const taskQueryKeys = {
  tasks: (hid: string, bid: string) => ['households', hid, 'boards', bid, 'tasks'] as const,
  alerts: (hid: string) => ['households', hid, 'alerts'] as const,
};

export function useTasks(householdId: string, boardId: string) {
  const token = useToken();
  return useQuery({
    queryKey: taskQueryKeys.tasks(householdId, boardId),
    enabled: token !== null,
    queryFn: () => apiFetch<{ tasks: Task[] }>(`/v1/households/${householdId}/boards/${boardId}/tasks`, token!),
  });
}

export function useAlerts(householdId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: taskQueryKeys.alerts(householdId ?? ''),
    enabled: token !== null && householdId !== null,
    // Alerts drive the persistent nag banner, so they should not sit on the
    // 30s default staleTime — a completed task should disappear promptly.
    staleTime: 0,
    queryFn: () => apiFetch<{ alerts: Task[] }>(`/v1/households/${householdId}/alerts`, token!),
  });
}

function invalidateTaskQueries(qc: ReturnType<typeof useQueryClient>, hid: string, bid: string) {
  void qc.invalidateQueries({ queryKey: taskQueryKeys.tasks(hid, bid) });
  void qc.invalidateQueries({ queryKey: taskQueryKeys.alerts(hid) });
}

export function useCreateTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useUpdateTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateTaskInput }) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}`, required(token), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useCompleteTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}/complete`, required(token), { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useSnoozeTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: SnoozeTaskInput }) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}/snooze`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useDismissTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<{ task: Task }>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}/dismiss`, required(token), { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

export function useDeleteTask(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<void>(`/v1/households/${householdId}/boards/${boardId}/tasks/${taskId}`, required(token), { method: 'DELETE' }),
    onSuccess: () => invalidateTaskQueries(qc, householdId, boardId),
  });
}

// --- checklist boards ------------------------------------------------------

export const checklistQueryKeys = {
  items: (hid: string, bid: string) => ['households', hid, 'boards', bid, 'items'] as const,
};

export function useChecklistItems(householdId: string, boardId: string) {
  const token = useToken();
  return useQuery({
    queryKey: checklistQueryKeys.items(householdId, boardId),
    enabled: token !== null,
    queryFn: () => apiFetch<{ items: ChecklistItem[] }>(`/v1/households/${householdId}/boards/${boardId}/items`, token!),
  });
}

function invalidateChecklistQueries(qc: ReturnType<typeof useQueryClient>, hid: string, bid: string) {
  void qc.invalidateQueries({ queryKey: checklistQueryKeys.items(hid, bid) });
}

export function useCreateChecklistItem(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChecklistItemInput) =>
      apiFetch<{ item: ChecklistItem }>(`/v1/households/${householdId}/boards/${boardId}/items`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateChecklistQueries(qc, householdId, boardId),
  });
}

export function useRenameChecklistItem(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: UpdateChecklistItemInput }) =>
      apiFetch<{ item: ChecklistItem }>(`/v1/households/${householdId}/boards/${boardId}/items/${itemId}`, required(token), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateChecklistQueries(qc, householdId, boardId),
  });
}

export function useToggleChecklistItem(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<{ item: ChecklistItem }>(`/v1/households/${householdId}/boards/${boardId}/items/${itemId}/toggle`, required(token), {
        method: 'POST',
      }),
    onSuccess: () => invalidateChecklistQueries(qc, householdId, boardId),
  });
}

export function useDeleteChecklistItem(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<void>(`/v1/households/${householdId}/boards/${boardId}/items/${itemId}`, required(token), { method: 'DELETE' }),
    onSuccess: () => invalidateChecklistQueries(qc, householdId, boardId),
  });
}

// --- text-entry boards ------------------------------------------------------

export const textQueryKeys = {
  doc: (hid: string, bid: string) => ['households', hid, 'boards', bid, 'doc'] as const,
};

export function useTextDoc(householdId: string, boardId: string) {
  const token = useToken();
  return useQuery({
    queryKey: textQueryKeys.doc(householdId, boardId),
    enabled: token !== null,
    queryFn: () => apiFetch<{ doc: TextDoc }>(`/v1/households/${householdId}/boards/${boardId}/doc`, token!),
  });
}

export function useSaveTextDoc(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blocks: TextBlock[]) =>
      apiFetch<{ doc: TextDoc }>(`/v1/households/${householdId}/boards/${boardId}/doc`, required(token), {
        method: 'PUT',
        body: JSON.stringify({ blocks }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: textQueryKeys.doc(householdId, boardId) }),
  });
}

// --- link boards ------------------------------------------------------------

export const linkQueryKeys = {
  link: (hid: string, bid: string) => ['households', hid, 'boards', bid, 'link'] as const,
};

export function useLinkDoc(householdId: string, boardId: string) {
  const token = useToken();
  return useQuery({
    queryKey: linkQueryKeys.link(householdId, boardId),
    enabled: token !== null,
    queryFn: () => apiFetch<{ link: LinkDoc }>(`/v1/households/${householdId}/boards/${boardId}/link`, token!),
  });
}

export function useSaveLinkDoc(householdId: string, boardId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; icon: LinkIcon }) =>
      apiFetch<{ link: LinkDoc }>(`/v1/households/${householdId}/boards/${boardId}/link`, required(token), {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: linkQueryKeys.link(householdId, boardId) }),
  });
}
