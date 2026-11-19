import { useRef } from "react";
import { gsap, ScrollTrigger, useGSAP } from "../lib/motion";

const N = 41;

/**
 * Scroll position as a strip of ticks at the bottom of the screen: ticks near the playhead rise and
 * brighten. Decorative (aria-hidden); the scrollbar remains the real control.
 */
export function Ruler() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const ticks = gsap.utils.toArray<HTMLElement>("[data-tick]", root.current);
      const sy = ticks.map((t) => gsap.quickSetter(t, "scaleY"));
      const so = ticks.map((t) => gsap.quickSetter(t, "opacity"));
      const draw = (p: number) => {
        const c = p * (N - 1);
        for (let i = 0; i < N; i++) {
          const d = Math.abs(i - c);
          const k = Math.exp(-(d * d) / 6);
          sy[i](1 + k * 2.2);
          so[i](0.22 + k * 0.78);
        }
      };
      draw(0);
      let hidden = false;
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (s) => {
          draw(s.progress);
          // Step aside for the footer.
          const h = s.end - s.scroll() < 220;
          if (h !== hidden) {
            hidden = h;
            gsap.to(root.current, { opacity: h ? 0 : 1, duration: 0.4, overwrite: "auto" });
          }
        },
      });
      gsap.from(root.current, { opacity: 0, y: 10, duration: 1, delay: 1.8, ease: "expo.out" });
    },
    { scope: root }
  );
  return (
    <div ref={root} className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex h-6 -translate-x-1/2 items-end gap-[4px] max-md:hidden" aria-hidden>
      {Array.from({ length: N }, (_, i) => (
        <span key={i} data-tick className="h-[7px] w-px origin-bottom bg-fg" style={{ opacity: 0.22 }} />
      ))}
    </div>
  );
}
