import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import type { RunStatus } from "@/lib/model";
import { STEPS } from "../data/content";
import { STORY } from "../lib/story";
import { MEASE, gsap, ScrollTrigger, scrollToY, useGSAP, useReduced } from "../lib/motion";
import { DiagnosisBlock, Frame, Glyph, Lanes, LogList, PlanBlock, PRBlock, VerdictBlock } from "../components/panels";

const N = STEPS.length;

/**
 * The job rail on the left of the run window: the one element that persists through every step and
 * changes state as the run progresses. States mirror the recorded run's event order.
 */
function railFor(step: number): { label: string; status: RunStatus; sub?: string }[] {
  const s = (from: number, to = Infinity): RunStatus => (step < from ? "queued" : step >= from && step < to ? "running" : "success");
  const a1: RunStatus = step < 2 ? "queued" : step === 2 ? "running" : step === 3 ? "failure" : step === 4 ? "running" : "success";
  return [
    { label: "Brief", status: s(0, 1) },
    { label: "Plan attempts", status: s(1, 2) },
    { label: `#1 ${STORY.a1.strategy.name}`, status: a1, sub: step === 3 ? "rejected" : step === 4 ? "debugging" : undefined },
    { label: `#2 ${STORY.a2.strategy.name}`, status: step < 2 ? "queued" : step === 2 ? "running" : "success", sub: step >= 3 ? "approved" : undefined },
    { label: "Evaluate", status: s(5, 6) === "running" ? "success" : s(5, 6) },
    { label: "Pull request", status: step >= 5 ? "success" : "queued" },
  ];
}

function Canvas({ step, active = true }: { step: number; active?: boolean }) {
  const [v1, v2] = [STORY.verdicts[0], STORY.verdicts[1]];
  const second = STORY.verdicts.find((v) => v.attempt.id === STORY.a1.id && v.pass)!;
  switch (step) {
    case 0:
      return <Brief active={active} />;
    case 1:
      return (
        <div className="flex flex-col gap-3">
          <Frame name="detected" meta={STORY.setup.source}>
            <div className="t-code">
              <span className="text-dim">test </span>
              <span className="text-fg">{STORY.setup.test}</span>
            </div>
          </Frame>
          <Frame name="strategies">
            <PlanBlock />
          </Frame>
        </div>
      );
    case 2:
      return (
        <div className="grid gap-3 xl:grid-cols-2">
          {[STORY.lines.coder1, STORY.lines.coder2].map((lines, i) => (
            <Frame key={i} name={`coder · #${i + 1} ${STORY.attempts[i].strategy.name}`}>
              <LogList lines={lines.filter((l) => l.kind !== "say").slice(0, 5)} />
            </Frame>
          ))}
        </div>
      );
    case 3:
      return (
        <div className="grid gap-3 xl:grid-cols-2">
          {[v1, v2].map((v) => (
            <Frame key={v.attempt.id} name={`qa · #${v.attempt.index} ${v.attempt.strategy.name}`} meta={fmtClock(v.at)}>
              <VerdictBlock v={v} />
            </Frame>
          ))}
        </div>
      );
    case 4:
      return (
        <div className="flex flex-col gap-3">
          <Frame name={`debugger · #${STORY.a1.index}`} meta={fmtClock(STORY.diagnosis.at)}>
            <DiagnosisBlock />
          </Frame>
          <Frame name={`qa · second review`} meta={fmtClock(second.at)}>
            <VerdictBlock v={second} />
          </Frame>
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-3">
          <Frame name="evaluate">
            <p className="text-[13px] leading-snug text-fg-2">
              <span className="font-mono text-fg">#{STORY.winner.index} {STORY.winner.strategy.name}</span> wins. {STORY.winnerReason}
            </p>
          </Frame>
          <Frame name="pull request" meta={fmtClock(STORY.pr.at)}>
            <PRBlock />
          </Frame>
          <Frame name="trace">
            <Lanes ms={STORY.duration} />
          </Frame>
        </div>
      );
  }
}

function Brief({ active }: { active: boolean }) {
  const text = STORY.prompt;
  const reduced = useReduced();
  const [n, setN] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced || !active) return setN(text.length);
    setN(0);
    const id = setInterval(() => setN((x) => Math.min(text.length, x + 2)), 28);
    return () => clearInterval(id);
  }, [active, reduced, text.length]);
  return (
    <Frame name="new task">
      <div className="flex flex-col gap-4">
        <p className="min-h-[48px] text-[15px] leading-snug text-fg">
          {text.slice(0, n)}
          {n < text.length && <span className="caret ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] bg-accent" aria-hidden />}
        </p>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="rounded-[4px] border border-line px-2 py-1 text-mute">repo {STORY.run.task.repo}</span>
          <span className="rounded-[4px] border border-line px-2 py-1 text-mute">attempts {STORY.attempts.length}</span>
          <span className={cn("ml-auto rounded-full px-3 py-1 font-sans text-[12px] transition-colors duration-300", n >= text.length ? "bg-fg text-on-fg" : "bg-s3 text-dim")}>Start task</span>
        </div>
      </div>
    </Frame>
  );
}

function Rail({ step }: { step: number }) {
  return (
    <ol className="flex flex-col gap-0.5" aria-label="Jobs">
      {railFor(step).map((r) => (
        <li key={r.label} className="flex h-8 items-center gap-2.5 rounded-[5px] px-2.5 text-[12.5px]">
          <Glyph status={r.status} />
          <span className={cn("truncate transition-colors duration-500", r.status === "queued" ? "text-dim" : "text-fg")}>{r.label}</span>
          {r.sub && <span className={cn("ml-auto truncate font-mono text-[10px]", r.status === "failure" ? "text-bad" : "text-mute")}>{r.sub}</span>}
        </li>
      ))}
    </ol>
  );
}

export function Workflow() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReduced();
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState(false);
  const st = useRef<ScrollTrigger | null>(null);

  useGSAP(
    () => {
      gsap.from("[data-reveal]", { y: 30, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: root.current, start: "top 75%" } });
      const mm = gsap.matchMedia();
      mm.add({ desktop: "(min-width: 1024px)", motion: "(prefers-reduced-motion: no-preference)" }, (ctx) => {
        const { desktop, motion } = ctx.conditions as { desktop: boolean; motion: boolean };
        if (!desktop || !motion) {
          setPinned(false);
          return;
        }
        setPinned(true);
        st.current = ScrollTrigger.create({
          trigger: "[data-track]",
          start: "top top",
          end: "bottom bottom",
          onUpdate: (s) => {
            setStep(Math.min(N - 1, Math.floor(s.progress * N)));
            gsap.set("[data-progress]", { scaleX: s.progress });
          },
        });
        return () => {
          st.current = null;
        };
      });
    },
    { scope: root }
  );

  // Big number rolls to the active step.
  useGSAP(
    () => {
      if (!pinned) return;
      gsap.to("[data-num-col]", { yPercent: (-100 / N) * step, duration: 0.9, ease: "expo.out" });
    },
    { scope: root, dependencies: [step, pinned] }
  );

  const goTo = (i: number) => {
    const s = st.current;
    if (!s) return;
    scrollToY(s.start + ((s.end - s.start) * (i + 0.5)) / N);
  };

  return (
    <section ref={root} id="workflow" aria-labelledby="workflow-title" className="relative">
      <div className="page-x pt-[12vh] max-md:pt-24">
        <div className="grid items-end gap-6 md:grid-cols-[1fr_minmax(0,380px)]">
          <h2 id="workflow-title" className="t-h2" data-reveal>
            How a run works
          </h2>
          <p className="t-body md:text-right" data-reveal>
            {N} steps from a prompt to a pull request, as the orchestrator runs them. Shown on the recorded run.
          </p>
        </div>
      </div>

      {pinned ? (
        <div data-track style={{ height: `${N * 85 + 100}svh` }}>
          <div className="page-x sticky top-0 grid h-svh grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-10 pt-[calc(var(--nav-h)+4vh)] pb-20">
            {/* left: number, step copy, step list */}
            <div className="flex min-h-0 flex-col">
              <div className="h-[0.8em] overflow-hidden t-num" aria-hidden>
                <div data-num-col>
                  {STEPS.map((_, i) => (
                    <div key={i} className="h-[0.8em]">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-8 min-h-[150px]" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={step} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4, ease: MEASE }}>
                    <h3 className="t-h3">{STEPS[step].title}</h3>
                    <p className="t-body mt-3 max-w-[40ch]">{STEPS[step].body}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="mt-auto pb-10 font-mono text-[11px] text-dim">
                step {step + 1} of {N} · task {STORY.run.task.id.replace(/^t_/, "")} · {STORY.repo}
              </div>
            </div>

            {/* right: the run window */}
            <div className="flex min-h-0 flex-col justify-center">
              <div className="panel grid min-h-[440px] grid-cols-[236px_minmax(0,1fr)] overflow-hidden">
                <div className="border-r border-line p-2">
                  <div className="px-2.5 pt-1.5 pb-2 font-mono text-[10.5px] text-dim">task {STORY.run.task.id.replace(/^t_/, "")}</div>
                  <Rail step={step} />
                </div>
                <div className="relative bg-bg/50 p-5">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.35, ease: MEASE }}
                    >
                      <Canvas step={step} />
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* bottom: stepper */}
            <div className="absolute inset-x-[max(20px,2.4vw)] bottom-14 col-span-2">
              <div className="relative h-px bg-line">
                <div data-progress className="absolute inset-0 origin-left scale-x-0 bg-fg" />
              </div>
              <div className="mt-3 grid" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
                {STEPS.map((s, i) => (
                  <button key={s.id} type="button" onClick={() => goTo(i)} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-2 text-left text-[12px] transition-colors duration-500", i === step ? "text-fg" : "text-dim hover:text-mute")}>
                    <span aria-hidden className={cn("grid size-5 place-items-center rounded-full border font-mono text-[10px]", i === step ? "border-fg bg-fg text-on-fg" : "border-line-2")}>{i + 1}</span>
                    {s.short}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ol className="page-x mt-12 flex flex-col gap-14 pb-24">
          {STEPS.map((s, i) => (
            <li key={s.id} className="grid gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-10">
              <div>
                <div className="t-num text-[96px]!" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="t-h3 mt-4">{s.title}</h3>
                <p className="t-body mt-2 max-w-[40ch]">{s.body}</p>
              </div>
              <StepFallback step={i} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StepFallback({ step }: { step: number }): ReactNode {
  return (
    <div className="rounded-[8px] border border-line bg-s2 p-3 md:p-5">
      <Canvas step={step} active={false} />
    </div>
  );
}
