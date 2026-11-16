import { useEffect, useState } from "react";

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#/, "") || "/tasks";
  const [p, q = ""] = raw.split("?");
  return { path: p.split("/").filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(path: string, query?: Record<string, string | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  const next = `#${path}${s ? `?${s}` : ""}`;
  if (location.hash !== next) location.hash = next;
}

/** Update query params on the current path without adding noise. */
export function setQuery(patch: Record<string, string | null | undefined>) {
  const r = parse();
  for (const [k, v] of Object.entries(patch)) (v ? r.query.set(k, v) : r.query.delete(k));
  const s = r.query.toString();
  history.replaceState(null, "", `#/${r.path.join("/")}${s ? `?${s}` : ""}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
