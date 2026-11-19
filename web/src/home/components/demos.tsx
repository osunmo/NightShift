// Feature demonstrations. Each one replays a slice of the recorded run (or, for setup, the cache
// logic in src/setup/env.ts) and starts when its plate scrolls into view. With reduced motion they
// render their finished state.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import { STORY } from "../lib/story";
import { usePlayer } from "../lib/run";
import { gsap, useGSAP } from "../lib/motion";
import { Deliveries, DiffBlock, Frame, Glyph, Lanes, LogList, PlanBlock, VerdictBlock } from "./panels";

type DemoProps = { active: boolean; reduced: boolean };

/** Reveals children marked data-step one after another while `active`. */
function useSteps(active: boolean, reduced: boolean, opts: { stagger?: number; delay?: number } = {}) {
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  useGSAP(
    () => {
      if (reduced) return;
      tl.current = gsap
        .timeline({ paused: true })
        .from("[data-step]", { opacity: 0, y: 16, duration: 0.8, ease: "expo.out", stagger: opts.stagger ?? 0.55 }, opts.delay ?? 0.2);
    },
    { scope: root, dependencies: [reduced] }
  );
  useEffect(() => {
    if (!tl.current) return;
    if (active) tl.current.play();
    else tl.current.pause(0);
  }, [active]);
  return root;
}

/** Counts from 0 to n while active, one step per `every` ms. */
function useCounter(n: number, active: boolean, reduced: boolean, every = 520) {
  const [k, setK] = useState(reduced ? n : 0);
  useEffect(() => {
    if (reduced) return setK(n);
    if (!active) return setK(0);
    setK(0);
    const id = setInterval(() => setK((x) => (x >= n ? x : x + 1)), every);
    return () => clearInterval(id);
  }, [active, reduced, n, every]);
  return k;
}

export function ParallelDemo({ active, reduced }: DemoProps) {
  const p = usePlayer(STORY.duration, { autoplay: false, loop: true, reduced, speed: 0.8, holdMs: 3000 });
  useEffect(() => {
    if (reduced) return;
    if (active) p.restart();
    else p.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced]);
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-3">
      <Frame name="orchestrator / plan" meta={STORY.repo}>
        <PlanBlock />
      </Frame>
      <Frame name="trace" meta={fmtClock(p.ms)}>
        <Lanes ms={p.ms} />
      </Frame>
    </div>
  );
}

export function ReviewDemo({ active, reduced }: DemoProps) {
  const root = useSteps(active, reduced, { stagger: 0.7 });
  const v = STORY.rejected;
  return (
    <div ref={root} className="grid w-full max-w-[560px] grid-cols-[minmax(0,1fr)] gap-3">
      <div data-step>
        <Frame name={`attempt ${v.attempt.index} · ${v.attempt.strategy.name} · coder's diff`}>
          <DiffBlock diff={STORY.wrongDiff} max={3} />
        </Frame>
      </div>
      <div data-step>
        <Frame name="qa-1 · read-only review" meta={fmtClock(v.at)}>
          <LogList lines={STORY.lines.qa1.filter((l) => l.kind === "call")} />
        </Frame>
      </div>
      <div data-step>
        <Frame name="verdict">
          <VerdictBlock v={v} />
        </Frame>
      </div>
    </div>
  );
}

export function DebugDemo({ active, reduced }: DemoProps) {
  const lines = STORY.lines.debugger.filter((l) => l.kind !== "steer");
  const after = STORY.verdicts.find((v) => v.attempt.id === STORY.a1.id && v.pass)!;
  const k = useCounter(lines.length + 1, active, reduced, 650);
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-3">
      <Frame name={`debugger-1 · attempt ${STORY.a1.index} · round 1`} meta={k > 0 ? fmtClock(lines[Math.min(k, lines.length) - 1].ts - STORY.run.t0) : "00:00.0"}>
        <div className="min-h-[156px]">
          <LogList lines={lines} count={Math.min(k, lines.length)} caret={k <= lines.length && !reduced} />
        </div>
      </Frame>
      <div className={cn("transition-[opacity,transform] duration-700 ease-out", k > lines.length ? "opacity-100" : "translate-y-3 opacity-0")}>
        <Frame name="qa-2 · second review" meta={fmtClock(after.at)}>
          <VerdictBlock v={after} />
        </Frame>
      </div>
    </div>
  );
}

export function SteerDemo({ active, reduced }: DemoProps) {
  const text = STORY.steer.text;
  const typed = useCounter(text.length, active, reduced, 38);
  const sent = typed >= text.length;
  const deliveries = useCounter(STORY.steer.deliveries.length, active && sent, reduced, 700);
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-3">
      <Frame name="steer · all attempts">
        <div className="flex items-end gap-3">
          <p className="min-h-[44px] flex-1 text-[14px] leading-snug text-fg">
            {text.slice(0, typed)}
            {!sent && <span className="caret ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] bg-accent" aria-hidden />}
          </p>
          <span className={cn("rounded-full px-3 py-1 text-[12px] transition-colors duration-300", sent ? "bg-fg text-on-fg" : "bg-s3 text-dim")}>Send</span>
        </div>
      </Frame>
      <Frame name="inbox · delivered before each agent's next step">
        <div className="min-h-[40px]">
          <Deliveries count={deliveries} />
        </div>
      </Frame>
      <Frame name={`attempt ${STORY.a2.index} · qa-1`}>
        <div className={cn("transition-opacity duration-700", deliveries > 0 ? "opacity-100" : "opacity-0")}>
          <LogList lines={STORY.lines.qa2.filter((l) => l.kind === "steer" || l.kind === "call").slice(0, 3)} />
        </div>
      </Frame>
    </div>
  );
}

export function SetupDemo({ active, reduced }: DemoProps) {
  const root = useSteps(active, reduced, { stagger: 0.45 });
  return (
    <div ref={root} className="flex w-full max-w-[560px] flex-col gap-3">
      <div data-step>
        <Frame name={`setup · ${STORY.repo}`} meta={STORY.setup.source}>
          <div className="t-code">
            <div>
              <span className="text-dim">install </span>
              <span className="text-fg">{STORY.setup.install ?? "none needed"}</span>
            </div>
            <div>
              <span className="text-dim">test    </span>
              <span className="text-fg">{STORY.setup.test}</span>
            </div>
          </div>
        </Frame>
      </div>
      <div data-step>
        <Frame name="dependency cache · src/setup/env.ts">
          <div className="t-code flex flex-col gap-1">
            <div className="text-mute">key = sha256(sandbox, install command, lockfiles)</div>
            <CacheRow label="attempt 1" hit={false} />
            <CacheRow label="attempt 2" hit />
            <CacheRow label="next task" hit />
          </div>
        </Frame>
      </div>
      <div data-step>
        <Frame name=".nightshift.json · optional override">
          <pre className="t-code overflow-x-auto text-fg-2">{`{ "setup": "pnpm install --frozen-lockfile",
  "test": "pnpm test",
  "cachePaths": ["node_modules"],
  "lockfiles": ["pnpm-lock.yaml"] }`}</pre>
        </Frame>
      </div>
    </div>
  );
}

function CacheRow({ label, hit }: { label: string; hit: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Glyph status={hit ? "success" : "queued"} />
      <span className="w-20 text-fg-2">{label}</span>
      <span className={hit ? "text-ok" : "text-mute"}>{hit ? "hit · extract snapshot" : "miss · run install, save snapshot"}</span>
    </div>
  );
}

export const DEMOS = { parallel: ParallelDemo, review: ReviewDemo, debug: DebugDemo, steer: SteerDemo, setup: SetupDemo };
