import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HERO } from "../data/content";
import { GhostButton, LaunchButton } from "../components/ui";
import { Caption, DiagnosisBlock, DiffBlock, Frame, PRBlock, SteerBlock, VerdictBlock } from "../components/panels";
import { HeroRun } from "../components/RunView";
import { STORY } from "../lib/story";
import { RECORDED, usePlayer } from "../lib/run";
import { EASE, EASE_IO, gsap, ScrollTrigger, SplitText, useGSAP, useReduced } from "../lib/motion";
import { fmtClock } from "@/lib/format";

/**
 * Composition. Each satellite has a scattered position (fractions of the viewport, its center) and a
 * depth: far panels are smaller, dimmer and softer, and move less with the pointer. On scroll they
 * gather into a single row in the order the events happened in the run.
 */
type Sat = { id: string; w: number; x: number; y: number; depth: number; caption: string; body: ReactNode; mobile?: boolean };
const SATS: Sat[] = [
  { id: "diff", w: 250, x: 0.135, y: 0.33, depth: 0.55, caption: `attempt-1 / calc.py · ${fmtClock(STORY.wrongDiffAt)}`, body: <DiffBlock diff={STORY.wrongDiff} max={3} /> },
  { id: "steer", w: 290, x: 0.855, y: 0.27, depth: 1, caption: `inbox / message 1 · ${fmtClock(STORY.steer.at)}`, body: <SteerBlock />, mobile: true },
  { id: "verdict", w: 270, x: 0.165, y: 0.79, depth: 0.9, caption: `qa-1 / verdict · attempt 1 · ${fmtClock(STORY.rejected.at)}`, body: <VerdictBlock v={STORY.rejected} />, mobile: true },
  { id: "diagnosis", w: 270, x: 0.865, y: 0.6, depth: 0.7, caption: `debugger-1 / diagnosis · ${fmtClock(STORY.diagnosis.at)}`, body: <DiagnosisBlock /> },
  { id: "pr", w: 300, x: 0.8, y: 0.93, depth: 0.45, caption: `pull-request.md · ${fmtClock(STORY.pr.at)}`, body: <PRBlock /> },
];
const MAIN = { w: 540 };

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReduced();
  const [inView, setInView] = useState(true);
  const player = usePlayer(RECORDED.duration, { loop: true, speed: 0.9, reduced, active: inView });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const mm = gsap.matchMedia();

      mm.add(
        { desktop: "(min-width: 1024px)", motion: "(prefers-reduced-motion: no-preference)" },
        (ctx) => {
          const { desktop, motion } = ctx.conditions as { desktop: boolean; motion: boolean };
          const stage = q("[data-stage]")[0] as HTMLElement;
          const vw = () => stage.clientWidth;
          const vh = () => stage.clientHeight;

          // ---- layout: scattered positions (desktop) ----
          const place = (el: HTMLElement, w: number, x: number, y: number) => ({ x: x * vw() - w / 2, y: y * vh() - el.offsetHeight / 2 });
          // Bottom of the copy block, measured on untransformed elements (relative to the stage).
          const below = (sel: string) => {
            const el = q(sel)[0] as HTMLElement;
            return el.getBoundingClientRect().bottom - stage.getBoundingClientRect().top;
          };
          const main = q('[data-sat="main"]')[0] as HTMLElement;
          if (desktop) {
            gsap.set(main, { x: vw() / 2 - MAIN.w / 2, y: below("[data-hero-copy]") + 56 });
            for (const s of SATS) {
              const el = q(`[data-sat="${s.id}"]`)[0] as HTMLElement;
              const p = place(el, s.w, s.x, s.y);
              gsap.set(el, { ...p, scale: 0.78 + s.depth * 0.22, opacity: 0.35 + s.depth * 0.65 });
            }
          }
          if (!motion) return;

          // ---- 1. entrance choreography ----
          const split = SplitText.create(q("[data-headline-a] [data-line]"), { type: "words", mask: "words" });
          const tl = gsap.timeline({ defaults: { ease: EASE } });
          tl.from("[data-nav]", { y: -24, opacity: 0, duration: 1 }, 0)
            .from(split.words, { yPercent: 110, duration: 1.3, stagger: 0.045 }, 0.15)
            .from(q("[data-hero-copy] > *"), { y: 18, opacity: 0, duration: 1, stagger: 0.08 }, 0.65)
            .from(q("[data-enter]"), { y: 70, opacity: 0, scale: 0.94, duration: 1.4, stagger: 0.09 }, 0.8);

          // ---- 2. continuous drift, each panel on its own period ----
          const floats = q("[data-float]").map((el, i) =>
            gsap.to(el, { y: i % 2 ? 9 : -9, rotation: i % 2 ? 0.35 : -0.35, duration: 4.5 + i * 0.7, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 2 + i * 0.2 })
          );
          // Drift stops while the panels sit in their row, so the row reads as aligned.
          let drifting = true;
          const drift = (on: boolean) => {
            if (on === drifting) return;
            drifting = on;
            floats.forEach((t) => (on ? t.resume() : t.pause()));
            if (!on) gsap.to(q("[data-float]"), { y: 0, rotation: 0, duration: 0.6, ease: "power2.out", overwrite: false });
          };

          // ---- 3. pointer parallax by depth ----
          if (desktop && matchMedia("(pointer: fine)").matches) {
            const movers = [{ el: q('[data-par="main"]')[0], d: 0.35 }, ...SATS.map((s) => ({ el: q(`[data-par="${s.id}"]`)[0], d: s.depth }))].map(({ el, d }) => ({
              x: gsap.quickTo(el, "x", { duration: 1.2, ease: "power3.out" }),
              y: gsap.quickTo(el, "y", { duration: 1.2, ease: "power3.out" }),
              d,
            }));
            const onMove = (e: PointerEvent) => {
              const nx = e.clientX / innerWidth - 0.5;
              const ny = e.clientY / innerHeight - 0.5;
              for (const m of movers) {
                m.x(nx * -26 * m.d);
                m.y(ny * -18 * m.d);
              }
            };
            addEventListener("pointermove", onMove);
            ctx.add(() => () => removeEventListener("pointermove", onMove));
          }

          // ---- 4. pinned scroll: gather into the run's chronology, swap the headline ----
          if (!desktop) return;
          const rowTop = () => vh() * 0.765;
          // In the gathered layout the CTAs move up into the lead's place; the run window sits under them.
          const ctaH = () => (q("[data-ctas]")[0] as HTMLElement).offsetHeight;
          const mainTop = () => below("[data-headline-a]") + 24 + ctaH() + 30;
          const mainK = () => Math.min(0.8, (rowTop() - 36 - mainTop()) / main.offsetHeight);
          const pad = () => Math.max(20, vw() * 0.024);
          const gap = 14;
          const cellW = () => (vw() - pad() * 2 - gap * (SATS.length - 1)) / SATS.length;

          const st = gsap.timeline({
            defaults: { ease: EASE_IO },
            scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.35, invalidateOnRefresh: true, onUpdate: (self) => drift(self.progress < 0.2) },
          });
          st.addLabel("go", 0.12);
          st.to(q("[data-headline-a]"), { opacity: 0, y: -28, duration: 0.3 }, "go")
            .fromTo(q("[data-headline-b]"), { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.3 }, "go+=0.2")
            .to(q("[data-lead]"), { opacity: 0, y: -10, duration: 0.2 }, "go")
            .to(q("[data-ctas]"), { y: () => -(q("[data-lead]")[0] as HTMLElement).offsetHeight - 20, duration: 0.45 }, "go+=0.05")
;
          st.to(main, { x: () => vw() / 2 - MAIN.w / 2, y: () => mainTop() - (main.offsetHeight * (1 - mainK())) / 2, scale: mainK, duration: 0.6 }, "go");
          SATS.forEach((s, i) => {
            const el = q(`[data-sat="${s.id}"]`)[0] as HTMLElement;
            const k = () => cellW() / s.w;
            st.to(
              el,
              {
                x: () => pad() + i * (cellW() + gap) + cellW() / 2 - s.w / 2,
                y: () => rowTop() + (el.offsetHeight * k()) / 2 - el.offsetHeight / 2,
                scale: k,
                opacity: 1,
                duration: 0.6,
              },
              `go+=${0.03 * i}`
            );
          });
          st.fromTo(q("[data-row-rule]"), { scaleX: 0, y: () => rowTop() - 22 }, { scaleX: 1, duration: 0.4, ease: EASE }, "go+=0.45");
          st.to({}, { duration: 0.25 });
          ScrollTrigger.refresh();
        },
        root
      );
    },
    { scope: root }
  );

  return (
    <section id="top" ref={root} aria-labelledby="hero-title" className="relative motion-safe:lg:h-[260vh]">
      <div data-stage className="relative lg:sticky lg:top-0 lg:h-svh lg:min-h-[680px] lg:overflow-hidden">
        {/* Headline and copy */}
        <div className="page-x relative z-10 flex flex-col items-center pt-[calc(var(--nav-h)+7vh)] text-center max-lg:pt-[calc(var(--nav-h)+48px)]">
          <div className="grid">
            <h1 id="hero-title" data-headline-a className="t-hero [grid-area:1/1]">
              {HERO.lines.map((l) => (
                <span key={l} data-line className="block">
                  {l}
                </span>
              ))}
            </h1>
            <p data-headline-b aria-hidden className="t-hero pointer-events-none opacity-0 [grid-area:1/1] max-lg:hidden">
              {HERO.after.map((l) => (
                <span key={l} className="block">
                  {l}
                </span>
              ))}
            </p>
          </div>
          <div data-hero-copy className="mt-6 flex flex-col items-center">
            <p data-lead className="t-lead max-w-[540px] text-pretty">
              {HERO.lead}
            </p>
            <div data-ctas className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
              <LaunchButton />
              <GhostButton href="#workflow">See how a run works</GhostButton>
            </div>
          </div>
        </div>

        {/* Product composition */}
        <div className="page-x mx-auto mt-12 flex max-w-[640px] flex-col gap-4 pb-16 lg:pointer-events-none lg:absolute lg:inset-0 lg:m-0 lg:max-w-none lg:p-0">
          <Satellite id="main" width={MAIN.w} className="lg:pointer-events-auto">
            <HeroRun run={RECORDED} ms={player.ms} />
          </Satellite>
          {SATS.map((s) => (
            <Satellite key={s.id} id={s.id} width={s.w} className={cn(!s.mobile && "max-lg:hidden")}>
              <Caption>{s.caption}</Caption>
              <Frame>{s.body}</Frame>
            </Satellite>
          ))}
          <div data-row-rule className="absolute inset-x-[max(20px,2.4vw)] top-0 h-px origin-left scale-x-0 bg-line max-lg:hidden" aria-hidden />
        </div>

      </div>
    </section>
  );
}

/** Four nested layers so scroll, pointer, entrance and drift never fight over one transform. */
function Satellite({ id, width, className, children }: { id: string; width: number; className?: string; children: ReactNode }) {
  return (
    <div data-sat={id} style={{ "--w": `${width}px` } as CSSProperties} className={cn("w-full will-change-transform lg:absolute lg:top-0 lg:left-0 lg:w-[var(--w)]", className)}>
      <div data-par={id}>
        <div data-enter>
          <div data-float>{children}</div>
        </div>
      </div>
    </div>
  );
}
