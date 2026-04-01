import type { ApiResponse, ApiError, ApiSuccess } from "@sentinel/shared";

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
    credentials: "include", // cookie
  });

  if (res.status === 204) {
    return null as unknown as T;
  }

  let json: ApiResponse<T> | null = null;

  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    json = null;
  }

  if (!res.ok || (json && !json.success)) {
    const err = json as ApiError | null;
    const errorMessage =
      err?.error?.message ||
      "An unknown error occurred while processing the request.";
    const errorCode = err?.error?.code || "UNKNOWN_ERROR";

    throw new ApiRequestError(res.status, errorMessage, errorCode);
  }

  if (!json) {
    throw new ApiRequestError(
      res.status,
      "Failed to parse response from server.",
      "PARSE_ERROR",
    );
  }

  return (json as ApiSuccess<T>).data; // unwrap the data from the response
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
