import { useState } from "react";
import { useMonitors } from "../hooks/useMonitors.js";
import { useLogout } from "../hooks/useAuth.js";
import { MonitorCard } from "../components/MonitorCard.js";
import { CreateMonitorModal } from "../components/CreateMonitorModal.js";

export function Dashboard() {
  const { data: monitors, isLoading, isError } = useMonitors();
  const logout = useLogout();
  const [showCreate, setShowCreate] = useState(false);

  const totalMonitors = monitors?.length ?? 0;
  const upCount =
    monitors?.filter((m) => m.currentStatus?.result === "UP").length ?? 0;
  const downCount =
    monitors?.filter((m) => m.currentStatus?.result === "DOWN").length ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Nav */}
      <header className="border-b border-zinc-800/60 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
              Sentinel
            </span>
          </div>
          <button
            onClick={() => logout.mutate()}
            className="text-xs text-zinc-600 hover:text-zinc-400"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Summary bar */}
        <div className="mb-8 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-2xl font-bold text-zinc-100">{totalMonitors}</p>
            <p className="text-xs text-zinc-500">monitors</p>
          </div>
          {totalMonitors > 0 && (
            <>
              <div>
                <p className="text-2xl font-bold text-emerald-400">{upCount}</p>
                <p className="text-xs text-zinc-500">up</p>
              </div>
              {downCount > 0 && (
                <div>
                  <p className="text-2xl font-bold text-red-400">{downCount}</p>
                  <p className="text-xs text-zinc-500">down</p>
                </div>
              )}
            </>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary ml-auto"
          >
            + Add monitor
          </button>
        </div>

        {/* Monitor grid */}
        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-xl bg-zinc-900"
              />
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-red-400">
            Failed to load monitors. Check your connection.
          </p>
        )}

        {monitors && monitors.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-4xl">📡</p>
            <p className="mt-4 text-sm font-medium text-zinc-400">
              No monitors yet
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Add your first URL to start tracking uptime.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary mt-6"
            >
              Add monitor
            </button>
          </div>
        )}

        {monitors && monitors.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {monitors.map((m) => (
              <MonitorCard key={m.id} monitor={m} />
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateMonitorModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
