import type { ApiResponse, ApiError } from "@sentinel/shared";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options, // dışarıdan gelen method, body vb.
    headers: {
      "Content-Type": "application/json", // her istekte gider
      ...options.headers, // dışarıdan header geçilmişse üstüne eklenir
    },
  });

  const json = (await res.json()) as ApiResponse<T>;

  if (!res.ok) {
    const err = json as ApiError;
    throw new ApiRequestError(res.status, err.error.message, err.error.code);
  }

  return (json as { data: T }).data; // unwrap the data from the response
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
