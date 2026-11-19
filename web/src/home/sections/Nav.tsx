import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { NAV } from "../data/content";
import { HashLink, LaunchButton, Logo, ThemeToggle } from "../components/ui";
import { MEASE } from "../lib/motion";

/** Logo left, section links in a center pill, Launch app right. A full-screen menu below md. */
export function Nav() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);

  // Highlight the section in view.
  useEffect(() => {
    const els = NAV.map((n) => document.querySelector(n.href)).filter(Boolean) as Element[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive("#" + e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuBtn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <header data-nav className="page-x fixed inset-x-0 top-0 z-50 flex h-[var(--nav-h)] items-center before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:-z-10 before:h-[calc(100%+24px)] before:bg-gradient-to-b before:from-bg before:via-bg/85 before:to-transparent">
      <a href="#top" className="flex items-center gap-2 text-fg" aria-label="Nightshift, back to top">
        <Logo className="size-5" />
        <span className="font-display text-[17px] font-medium tracking-[-0.02em]">Nightshift</span>
      </a>

      <nav aria-label="Sections" className="absolute left-1/2 -translate-x-1/2 max-md:hidden">
        <ul className="flex items-center gap-1 rounded-full border border-line bg-s1 p-1">
          {NAV.map((n) => (
            <li key={n.href}>
              <HashLink
                href={n.href}
                className={cn("block rounded-full px-3.5 py-1.5 text-[13px] transition-colors duration-300", active === n.href ? "bg-s3 text-fg" : "text-mute hover:text-fg")}
              >
                {n.label}
              </HashLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle className="relative z-[60]" />
        <LaunchButton size="sm" className="max-md:hidden" />
        <button
          ref={menuBtn}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="relative z-[60] h-8 rounded-full border border-line-2 bg-s1 px-3.5 text-[13px] text-fg md:hidden"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: MEASE }}
            className="page-x fixed inset-0 z-[55] flex flex-col bg-bg pt-24 pb-10 md:hidden"
          >
            <nav aria-label="Sections">
              <ul className="flex flex-col">
                {NAV.map((n, i) => (
                  <motion.li key={n.href} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 + i * 0.05, ease: MEASE }} className="border-b border-line">
                    <HashLink href={n.href} onNavigate={() => setOpen(false)} className="flex items-baseline justify-between py-4">
                      <span className="t-h3">{n.label}</span>
                      <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                    </HashLink>
                  </motion.li>
                ))}
              </ul>
            </nav>
            <LaunchButton size="lg" className="mt-auto self-start" />
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
