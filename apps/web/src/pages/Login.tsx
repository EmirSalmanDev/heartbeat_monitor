import { useState } from "react";
import { Link } from "react-router-dom";
import React from "react";
import { useLogin } from "../hooks/useAuth.js";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Monitor your services, sleep well."
      footer={
        <>
          No account?{" "}
          <Link
            to="/register"
            className="text-emerald-400 hover:text-emerald-300"
          >
            Register
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-field"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field"
        />
        {login.error && (
          <p className="text-xs text-red-400">{login.error.message}</p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="btn-primary w-full"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------ //

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}

function AuthLayout({ title, subtitle, footer, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-4">
      {/* Logo mark */}
      <div className="mb-8 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
          Sentinel
        </span>
      </div>

      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="mb-1 text-lg font-semibold text-zinc-100">{title}</h1>
        <p className="mb-6 text-sm text-zinc-500">{subtitle}</p>
        {children}
      </div>

      <p className="mt-6 text-xs text-zinc-600">{footer}</p>
    </div>
  );
}
