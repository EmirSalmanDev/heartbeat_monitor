import { useState } from "react";
import { Link } from "react-router-dom";
import { useRegister } from "../hooks/useAuth.js";

export function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const register = useRegister();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    register.mutate({ email, password });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-4">
      <div className="mb-8 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
          Sentinel
        </span>
      </div>

      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="mb-1 text-lg font-semibold text-zinc-100">
          Create account
        </h1>
        <p className="mb-6 text-sm text-zinc-500">
          Start monitoring in minutes.
        </p>

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
            minLength={8}
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
          />
          {register.error && (
            <p className="text-xs text-red-400">{register.error.message}</p>
          )}
          <button
            type="submit"
            disabled={register.isPending}
            className="btn-primary w-full"
          >
            {register.isPending ? "Creating account…" : "Create account"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs text-zinc-600">
        Already have an account?{" "}
        <Link to="/login" className="text-emerald-400 hover:text-emerald-300">
          Sign in
        </Link>
      </p>
    </div>
  );
}
