import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { UserDto } from "@sentinel/shared";
import { api, ApiRequestError } from "../lib/api.js";

interface AuthMe {
  userId: string;
}

interface AuthResponse {
  message: string;
  user: UserDto;
}

export function useMe() {
  return useQuery<AuthMe, ApiRequestError>({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthMe>("/api/auth/me"),
    retry: false,
    staleTime: Infinity, // sayfa yenilendiğinde yeniden sorgulanır
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // useMutation: sunucuda veri değiştiren işlemler için (POST/PATCH/DELETE)
  // useQuery'den farkı: otomatik çalışmaz, mutate() çağrılınca tetiklenir
  return useMutation<
    AuthResponse,
    ApiRequestError,
    { email: string; password: string }
  >({
    mutationFn: (body) => api.post<AuthResponse>("/api/auth/login", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] }); // useMe'yi yeniden fetch ettirir
      navigate("/dashboard");
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<
    AuthResponse,
    ApiRequestError,
    { email: string; password: string }
  >({
    mutationFn: (body) => api.post<AuthResponse>("/api/auth/register", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      navigate("/dashboard");
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<unknown, ApiRequestError, void>({
    mutationFn: () => api.post("/api/auth/logout", {}),
    onSuccess: () => {
      queryClient.clear(); // cache
      navigate("/login");
    },
  });
}
