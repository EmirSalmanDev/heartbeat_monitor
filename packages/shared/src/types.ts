export interface UserDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface MonitorDto {
  id: string;
  userId: string;
  name: string;
  url: string;
  intervalSecs: number;
  status: "ACTIVE" | "PAUSED";
  createdAt: string;
  updatedAt: string;
  currentStatus?: CurrentStatus | null;
  uptime24h?: number | null;
  avgLatency24h?: number | null;
}

export interface CheckDto {
  id: string;
  monitorId: string;
  result: "UP" | "DOWN";
  statusCode: number | null;
  latencyMs: number | null;
  errorMsg: string | null;
  checkedAt: string;
}

export interface AlertDto {
  id: string;
  monitorId: string;
  type: "DOWN" | "RECOVERED";
  sentAt: string;
}

export interface CurrentStatus {
  result: "UP" | "DOWN";
  statusCode: number | null;
  latencyMs: number | null;
  checkedAt: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
