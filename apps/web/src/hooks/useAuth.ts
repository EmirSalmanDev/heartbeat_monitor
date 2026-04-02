import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { UserDto } from "@sentinel/shared";
import { api, ApiRequestError } from "../lib/api.js";

interface AuthMe {
  userId: string;
}

interface LoginResponse {
  message: string;
}

interface RegisterResponse {
  message: string;
  user: UserDto;
}

// cookie geçerliyse userId dön
export function useMe() {
  return useQuery<AuthMe, ApiRequestError>({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthMe>("/api/auth/me"),
    retry: false,
    staleTime: Infinity, // sayfa yenilenene kadar tekrar istek atmaz
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // useMutation: sunucuda veri değiştiren işlemler için (POST/PATCH/DELETE)
  // useQuery'den farkı: otomatik çalışmaz, mutate() çağrılınca tetiklenir
  return useMutation<
    LoginResponse,
    ApiRequestError,
    { email: string; password: string }
  >({
    mutationFn: (body) => api.post<LoginResponse>("/api/auth/login", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] }); // useMe'yi yeniden fetch ettirir
      navigate("/dashboard");
    },
  });
}

// Register — login'den farklı olarak user objesi de dönüyor
export function useRegister() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<
    RegisterResponse,
    ApiRequestError,
    { email: string; password: string }
  >({
    mutationFn: (body) =>
      api.post<RegisterResponse>("/api/auth/register", body),
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
