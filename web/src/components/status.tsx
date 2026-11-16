import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/model";
import type { Role } from "@/lib/api";

/** Run status glyph in the GitHub Actions style: check, cross, spinning ring, hollow circle, slash. */
export function StatusIcon({ status, className, paused }: { status: RunStatus; className?: string; paused?: boolean }) {
  const cls = cn("size-4 shrink-0", className);
  if (paused && status === "running")
    return (
      <svg viewBox="0 0 16 16" className={cn(cls, "text-warning")} aria-label="Paused">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.16" />
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.25 5.5v5M9.75 5.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  switch (status) {
    case "success":
      return (
        <svg viewBox="0 0 16 16" className={cn(cls, "text-success")} aria-label="Succeeded">
          <circle cx="8" cy="8" r="7.25" fill="currentColor" />
          <path d="M5 8.25 7 10.25 11 6" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "failure":
      return (
        <svg viewBox="0 0 16 16" className={cn(cls, "text-danger")} aria-label="Failed">
          <circle cx="8" cy="8" r="7.25" fill="currentColor" />
          <path d="M5.75 5.75 10.25 10.25M10.25 5.75 5.75 10.25" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "running":
      return (
        <svg viewBox="0 0 16 16" className={cn(cls, "text-brand")} aria-label="Running">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
          <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.9s" repeatCount="indefinite" />
          </path>
        </svg>
      );
    case "cancelled":
      return (
        <svg viewBox="0 0 16 16" className={cn(cls, "text-muted-foreground")} aria-label="Cancelled">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 12 12 4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "skipped":
    case "queued":
    default:
      return (
        <svg viewBox="0 0 16 16" className={cn(cls, "text-muted-foreground")} aria-label="Queued">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
        </svg>
      );
  }
}

const LABEL: Record<RunStatus, string> = {
  success: "Succeeded",
  failure: "Failed",
  running: "Running",
  cancelled: "Cancelled",
  queued: "Queued",
  skipped: "Skipped",
};

export function StatusLabel({ status, paused, text }: { status: RunStatus; paused?: boolean; text?: string }) {
  const tone =
    paused && status === "running"
      ? "text-warning bg-warning-soft"
      : status === "success"
        ? "text-success bg-success-soft"
        : status === "failure"
          ? "text-danger bg-danger-soft"
          : status === "running"
            ? "text-brand bg-brand-soft"
            : "text-muted-foreground bg-muted";
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium", tone)}>
      {text ?? (paused && status === "running" ? "Paused" : LABEL[status])}
    </span>
  );
}

/** Small square role marker. Roles are told apart by shape-free neutral tones plus the label, not by color alone. */
export function RoleMark({ role, className }: { role: Role; className?: string }) {
  const letter = { orchestrator: "O", coder: "C", qa: "Q", debugger: "D", user: "Y", system: "S" }[role] ?? "?";
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border font-mono text-[9px] font-semibold",
        role === "user" ? "border-brand/30 bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
        className
      )}
      aria-hidden
    >
      {letter}
    </span>
  );
}
