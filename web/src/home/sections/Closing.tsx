import { useRef } from "react";
import { NAV } from "../data/content";
import { HashLink, LaunchButton, Logo, APP_URL, APP_LABEL } from "../components/ui";
import { EASE, gsap, SplitText, useGSAP, useReduced } from "../lib/motion";

const TICKS = 96;

/**
 * The ending: the scroll ruler from the bottom of the screen, stretched into a horizon that breathes
 * slowly behind the closing line.
 */
export function Closing() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReduced();
  useGSAP(
    () => {
      if (reduced) return;
      const split = SplitText.create("[data-close-line]", { type: "words", mask: "words" });
      gsap.from(split.words, { yPercent: 110, duration: 1.4, ease: EASE, stagger: 0.06, scrollTrigger: { trigger: root.current, start: "top 60%" } });
      gsap.from("[data-close-cta] > *", { y: 20, opacity: 0, duration: 1.1, ease: EASE, stagger: 0.1, scrollTrigger: { trigger: root.current, start: "top 45%" } });
      const ticks = gsap.utils.toArray<HTMLElement>("[data-htick]");
      // Rise into a horizon profile once, then the whole horizon breathes.
      gsap.fromTo(
        ticks,
        { scaleY: 0 },
        { scaleY: (i) => 0.6 + 3.2 * Math.exp(-((i - TICKS / 2) ** 2) / 320), duration: 1.8, ease: EASE, stagger: { each: 0.01, from: "center" }, scrollTrigger: { trigger: root.current, start: "top 55%" } }
      );
      gsap.to("[data-horizon]", { scaleY: 1.3, duration: 3.2, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 2 });
    },
    { scope: root, dependencies: [reduced] }
  );

  return (
    <footer ref={root} aria-labelledby="close-title" className="relative overflow-hidden">
      <div className="page-x flex min-h-[100svh] flex-col items-center justify-center pt-24 pb-48 text-center">
        <h2 id="close-title" className="t-hero">
          <span data-close-line className="block">
            Hand it off.
          </span>
          <span data-close-line className="block text-mute">
            Sleep on it.
          </span>
        </h2>
        <div data-close-cta className="mt-10 flex flex-col items-center gap-5">
          <LaunchButton size="lg" />
          <p className="font-mono text-[12px] text-dim">
            or try it without an API key: <span className="text-fg-2">npm run demo</span>
          </p>
        </div>
      </div>

      <div data-horizon className="pointer-events-none absolute inset-x-0 bottom-[132px] flex h-16 origin-bottom items-end justify-between px-[max(20px,2.4vw)]" aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => (
          <span key={i} data-htick className="h-4 w-px origin-bottom bg-fg" style={{ opacity: 0.14 + 0.55 * Math.exp(-((i - TICKS / 2) ** 2) / 500), transform: reduced ? `scaleY(${0.6 + 3.2 * Math.exp(-((i - TICKS / 2) ** 2) / 320)})` : undefined }} />
        ))}
      </div>

      <div className="page-x relative flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-line py-8 text-[13px]">
        <a href="#top" className="flex items-center gap-2 text-fg" aria-label="Nightshift, back to top">
          <Logo className="size-4" />
          <span className="font-display font-medium tracking-[-0.02em]">Nightshift</span>
        </a>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-mute">
            <li>
              <a href={APP_URL} className="transition-colors hover:text-fg">
                {APP_LABEL}
              </a>
            </li>
            {NAV.map((n) => (
              <li key={n.href}>
                <HashLink href={n.href} className="transition-colors hover:text-fg">
                  {n.label}
                </HashLink>
              </li>
            ))}
          </ul>
        </nav>
        <p className="ml-auto font-mono text-[11px] text-dim max-sm:ml-0">MIT License · Built with GSAP and Motion</p>
      </div>
    </footer>
  );
}
