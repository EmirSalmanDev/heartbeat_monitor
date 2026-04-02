import { useRef, useState } from "react";
import { useCreateMonitor } from "../hooks/useMonitors.js";
import type { FormEvent, MouseEvent, ReactNode } from "react";

interface CreateMonitorModalProps {
  onClose: () => void;
}

export function CreateMonitorModal({ onClose }: CreateMonitorModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [intervalSecs, setIntervalSecs] = useState(60);
  const createMonitor = useCreateMonitor();
  const backdropRef = useRef<HTMLDivElement>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    createMonitor.mutate({ name, url, intervalSecs }, { onSuccess: onClose });
  }

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-monitor-modal-title"
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="create-monitor-modal-title"
            className="text-sm font-semibold text-zinc-100"
          >
            Add monitor
          </h2>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-400"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production API"
              className="input-field"
            />
          </Field>

          <Field label="URL">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/health"
              className="input-field"
            />
          </Field>

          <Field label="Check interval">
            <select
              value={intervalSecs}
              onChange={(e) => setIntervalSecs(Number(e.target.value))}
              className="input-field"
            >
              <option value={30}>Every 30 seconds</option>
              <option value={60}>Every 1 minute</option>
              <option value={300}>Every 5 minutes</option>
              <option value={600}>Every 10 minutes</option>
            </select>
          </Field>

          {createMonitor.error && (
            <p className="text-xs text-red-400">
              {createMonitor.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMonitor.isPending}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              {createMonitor.isPending ? "Creating…" : "Create monitor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}
