import { Navigate } from "react-router-dom";
import { useMe } from "../hooks/useAuth.js";
import type { ReactNode } from "react";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { data, isLoading, isError } = useMe();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <span className="text-xs tracking-widest text-zinc-600 animate-pulse">
          LOADING…
        </span>
      </div>
    );
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
