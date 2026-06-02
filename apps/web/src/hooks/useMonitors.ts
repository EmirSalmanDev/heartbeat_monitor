import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MonitorDto, CurrentStatus, CheckDto } from "@sentinel/shared";
import { api, ApiRequestError } from "../lib/api.js";

export function useMonitors() {
  return useQuery<MonitorDto[], ApiRequestError>({
    queryKey: ["monitors"],
    queryFn: () => api.get<MonitorDto[]>("/api/monitors"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useMonitor(id: string) {
  return useQuery<MonitorDto, ApiRequestError>({
    queryKey: ["monitors", id],
    queryFn: () => api.get<MonitorDto>(`/api/monitors/${id}`),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useMonitorStatus(id: string) {
  return useQuery<CurrentStatus | null, ApiRequestError>({
    queryKey: ["monitors", id, "status"],
    queryFn: () => api.get<CurrentStatus | null>(`/api/monitors/${id}/status`),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useMonitorChecks(id: string, page = 1, limit = 20) {
  return useQuery<
    { checks: CheckDto[]; total: number; page: number; limit: number },
    ApiRequestError
  >({
    queryKey: ["monitors", id, "checks", page, limit],
    queryFn: () =>
      api.get(`/api/monitors/${id}/checks?page=${page}&limit=${limit}`),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// MUTATION HOOKS

export function useCreateMonitor() {
  const queryClient = useQueryClient();
  return useMutation<
    MonitorDto,
    ApiRequestError,
    { name: string; url: string; intervalSecs: number }
  >({
    mutationFn: (body) => api.post<MonitorDto>("/api/monitors", body),
    onSuccess: () => {
      // Ekleme başarılı olursa, mevcut liste cache'ini invalid olarak işaretle.
      queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });
}

export function useUpdateMonitor(id: string) {
  const queryClient = useQueryClient();
  return useMutation<
    MonitorDto,
    ApiRequestError,
    Partial<{
      // hepsine ? koyar
      name: string;
      url: string;
      intervalSecs: number;
      status: "ACTIVE" | "PAUSED";
    }>
  >({
    mutationFn: (body) => api.patch<MonitorDto>(`/api/monitors/${id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(["monitors", id], updated);
      queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });
}

export function useDeleteMonitor() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiRequestError, string>({
    // body yok diye void, id string
    mutationFn: (id) => api.delete(`/api/monitors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });
}
