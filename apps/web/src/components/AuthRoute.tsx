import { Navigate } from "react-router-dom";
import { useMe } from "../hooks/useAuth.js";
import type { ReactNode } from "react";

interface AuthRouteProps {
  children: ReactNode;
}

export function AuthRoute({ children }: AuthRouteProps) {
  const { data, isLoading } = useMe();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <span className="text-xs tracking-widest text-zinc-600 animate-pulse">
          LOADING…
        </span>
      </div>
    );
  }

  if (data) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
