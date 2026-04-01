interface StatusBadgeProps {
  status: "UP" | "DOWN" | "UNKNOWN";
  pulse?: boolean;
}

export function StatusBadge({ status, pulse = false }: StatusBadgeProps) {
  const map = {
    UP: {
      dot: "bg-emerald-400",
      text: "text-emerald-400",
      label: "UP",
    },
    DOWN: {
      dot: "bg-red-400",
      text: "text-red-400",
      label: "DOWN",
    },
    UNKNOWN: {
      dot: "bg-zinc-500",
      text: "text-zinc-500",
      label: "UNKNOWN",
    },
  };

  const { dot, text, label } = map[status];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        {pulse && status !== "UNKNOWN" && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dot}`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      <span className={`text-xs font-semibold tracking-widest ${text}`}>
        {label}
      </span>
    </span>
  );
}
