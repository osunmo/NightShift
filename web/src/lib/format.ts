export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.max(0, Math.round(ms / 100) / 10).toFixed(1)}s`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rest).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

export function fmtAgo(ts: string | number, now = Date.now()): string {
  const s = (now - new Date(ts).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortRepo(repo: string): string {
  const gh = repo.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
  if (gh !== repo) return gh;
  const parts = repo.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

export const shortId = (id: string) => id.replace(/^t_/, "");

export function argSummary(name: string, a: Record<string, any> = {}): string {
  if (a.path) return a.path;
  if (a.command) return a.command;
  if (a.pattern) return `/${a.pattern}/${a.path && a.path !== "." ? ` in ${a.path}` : ""}`;
  if (name === "submit_verdict") return a.pass ? "pass" : "fail";
  return a.message || a.summary || a.root_cause || a.guidance || "";
}
