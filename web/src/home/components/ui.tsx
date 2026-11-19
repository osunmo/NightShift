import { useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scrollToHash } from "../lib/motion";

export const APP_URL = "/app/";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6", className)} aria-hidden>
      <path d="M20.5 6.5a10 10 0 1 0 4.2 16A8.7 8.7 0 0 1 20.5 6.5z" fill="currentColor" />
    </svg>
  );
}

export function LaunchButton({ className, size = "md", children = "Launch app" }: { className?: string; size?: "sm" | "md" | "lg"; children?: ReactNode }) {
  return (
    <a
      href={APP_URL}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full bg-fg font-medium text-on-fg transition-[background-color,transform] duration-300 hover:bg-fg/85 active:scale-[0.98]",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-5 text-[14px]",
        size === "lg" && "h-12 px-6 text-[15px]",
        className
      )}
    >
      {children}
      <svg viewBox="0 0 16 16" className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden>
        <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

/** In-page link: smooth-scrolls and keeps the URL hash. */
export function HashLink({ href, className, children, onNavigate }: { href: string; className?: string; children: ReactNode; onNavigate?: () => void }) {
  const go = (e: MouseEvent) => {
    e.preventDefault();
    onNavigate?.();
    scrollToHash(href);
  };
  return (
    <a href={href} onClick={go} className={className}>
      {children}
    </a>
  );
}

export function GhostButton({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <HashLink href={href} className={cn("inline-flex h-10 items-center rounded-full border border-line-2 bg-s1 px-5 text-[14px] text-fg-2 transition-colors duration-300 hover:border-white/25 hover:text-fg", className)}>
      {children}
    </HashLink>
  );
}

/** Section header used by every section: a big title on the left, a short line of copy on the right. */
export function SectionHead({ id, title, aside, className }: { id: string; title: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid items-end gap-6 md:grid-cols-[1fr_minmax(0,340px)]", className)}>
      <h2 id={id} className="t-h2 text-balance" data-reveal>
        {title}
      </h2>
      {aside && (
        <p className="t-body text-pretty md:text-right" data-reveal>
          {aside}
        </p>
      )}
    </div>
  );
}

/**
 * Dark / light switch. Stored under the same key the app uses ("ns.theme"), so the homepage and the
 * app stay in step.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [light, setLight] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("light"));
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next ? "#f6f6f3" : "#030303");
    try {
      localStorage.setItem("ns.theme", next ? "light" : "dark");
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Dark mode" : "Light mode"}
      className={cn("grid size-8 place-items-center rounded-full border border-line-2 bg-s1 text-fg-2 transition-colors duration-300 hover:text-fg", className)}
    >
      {light ? (
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
          <path d="M11.5 2.8a5.5 5.5 0 1 0 1.7 7.9A4.8 4.8 0 0 1 11.5 2.8z" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
