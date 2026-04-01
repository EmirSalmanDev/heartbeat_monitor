import { useParams, Link } from "react-router-dom";
import {
  useMonitor,
  useMonitorStatus,
  useUpdateMonitor,
} from "../hooks/useMonitors.js";
import { StatusBadge } from "../components/StatusBadge.js";

export function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: monitor, isLoading, isError } = useMonitor(id!);
  const { data: status } = useMonitorStatus(id!);
  const updateMonitor = useUpdateMonitor(id!);

  if (isLoading) {
    return (
      <PageShell>
        <div className="h-48 animate-pulse rounded-xl bg-zinc-900" />
      </PageShell>
    );
  }

  if (isError || !monitor) {
    return (
      <PageShell>
        <p className="text-sm text-red-400">Monitor not found.</p>
      </PageShell>
    );
  }

  const liveStatus =
    status?.result ?? monitor.currentStatus?.result ?? "UNKNOWN";
  const isActive = monitor.status === "ACTIVE";

  function toggleStatus() {
    updateMonitor.mutate({ status: isActive ? "PAUSED" : "ACTIVE" });
  }

  return (
    <PageShell>
      {/* Back */}
      <Link
        to="/dashboard"
        className="mb-8 inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400"
      >
        ← Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">{monitor.name}</h1>
          <a
            href={monitor.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-sm text-zinc-500 hover:text-zinc-400"
          >
            {monitor.url}
          </a>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge
            status={isActive ? liveStatus : "UNKNOWN"}
            pulse={isActive}
          />
          <button
            onClick={toggleStatus}
            disabled={updateMonitor.isPending}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-600 hover:text-white disabled:opacity-50"
          >
            {isActive ? "Pause" : "Resume"}
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Status"
          value={monitor.status}
          accent={monitor.status === "ACTIVE" ? "emerald" : "zinc"}
        />
        <StatCard
          label="24h uptime"
          value={
            monitor.uptime24h != null ? `${monitor.uptime24h.toFixed(1)}%` : "—"
          }
          accent={
            monitor.uptime24h != null && monitor.uptime24h >= 99
              ? "emerald"
              : "zinc"
          }
        />
        <StatCard
          label="Avg latency"
          value={
            monitor.avgLatency24h != null
              ? `${Math.round(monitor.avgLatency24h)}ms`
              : "—"
          }
        />
        <StatCard label="Interval" value={`${monitor.intervalSecs}s`} />
      </div>

      {/* Last check */}
      {status && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <p className="mb-3 text-xs font-semibold tracking-widest text-zinc-600 uppercase">
            Last check
          </p>
          <div className="flex flex-wrap gap-6 text-sm">
            <Detail label="Result" value={status.result} />
            <Detail
              label="Status code"
              value={status.statusCode?.toString() ?? "—"}
            />
            <Detail
              label="Latency"
              value={status.latencyMs != null ? `${status.latencyMs}ms` : "—"}
            />
            <Detail
              label="Checked at"
              value={new Date(status.checkedAt).toLocaleString()}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ------------------------------------------------------------------ //

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800/60 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
            Sentinel
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = "zinc",
}: {
  label: string;
  value: string;
  accent?: "emerald" | "zinc";
}) {
  const valueClass =
    accent === "emerald" ? "text-emerald-400" : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className={`text-lg font-bold ${valueClass}`}>{value}</p>
      <p className="mt-0.5 text-xs text-zinc-600">{label}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-600">{label}</p>
      <p className="mt-0.5 text-sm text-zinc-200">{value}</p>
    </div>
  );
}
