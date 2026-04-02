import { useState } from "react";
import { Link } from "react-router-dom";
import type { MonitorDto } from "@sentinel/shared";
import { StatusBadge } from "./StatusBadge.js";
import { useDeleteMonitor, useUpdateMonitor } from "../hooks/useMonitors.js";

interface MonitorCardProps {
  monitor: MonitorDto;
}

export function MonitorCard({ monitor }: MonitorCardProps) {
  const [confirming, setConfirming] = useState(false);
  const deleteMonitor = useDeleteMonitor();
  const updateMonitor = useUpdateMonitor(monitor.id);

  const liveStatus = monitor.currentStatus?.result ?? "UNKNOWN";
  const uptime =
    monitor.uptime24h != null ? `${monitor.uptime24h.toFixed(1)}%` : "—";
  const latency =
    monitor.avgLatency24h != null
      ? `${Math.round(monitor.avgLatency24h)}ms`
      : "—";

  function toggleStatus() {
    updateMonitor.mutate({
      status: monitor.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
    });
  }

  function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    deleteMonitor.mutate(monitor.id);
  }

  return (
    <div className="group relative rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/monitors/${monitor.id}`}
            className="truncate text-sm font-semibold text-zinc-100 hover:text-white"
          >
            {monitor.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{monitor.url}</p>
        </div>
        <StatusBadge
          status={monitor.status === "PAUSED" ? "UNKNOWN" : liveStatus}
          pulse={monitor.status === "ACTIVE"}
        />
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-center gap-6 text-xs text-zinc-500">
        <span>
          <span className="text-zinc-300">{uptime}</span> uptime
        </span>
        <span>
          <span className="text-zinc-300">{latency}</span> avg
        </span>
        <span>
          every <span className="text-zinc-300">{monitor.intervalSecs}s</span>
        </span>
      </div>

      {/* Actions — visible on hover */}
      <div className="mt-4 flex items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
        <button
          onClick={toggleStatus}
          disabled={updateMonitor.isPending}
          className="rounded-md bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
        >
          {monitor.status === "ACTIVE" ? "Pause" : "Resume"}
        </button>
        <Link
          to={`/monitors/${monitor.id}`}
          className="rounded-md bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
        >
          Details
        </Link>
        <button
          onClick={handleDelete}
          onBlur={() => setConfirming(false)}
          disabled={deleteMonitor.isPending}
          className={`ml-auto rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
            confirming
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
              : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
          }`}
        >
          {confirming ? "Confirm delete" : "Delete"}
        </button>
      </div>
    </div>
  );
}
