import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import { SectionHead } from "../components/ui";
import { ReplayWindow } from "../components/RunView";
import { usePlayer, useRunData } from "../lib/run";
import { gsap, useGSAP, useReduced } from "../lib/motion";

/**
 * The whole run, end to end, in the app's run view. Uses the recording by default and switches to
 * the latest finished task when this page is served by a Nightshift server that has one.
 */
export function Replay() {
  const root = useRef<HTMLElement>(null);
  const run = useRunData();
  const reduced = useReduced();
  const [speed, setSpeed] = useState(1);
  const [seen, setSeen] = useState(false);
  const p = usePlayer(run.duration, { autoplay: false, speed, reduced });

  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  useEffect(() => {
    if (seen) p.restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, run]);

  useGSAP(
    () => {
      gsap.from("[data-reveal]", { y: 30, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: root.current, start: "top 75%" } });
      gsap.from("[data-window]", { y: 80, opacity: 0, scale: 0.97, duration: 1.6, ease: "expo.out", scrollTrigger: { trigger: "[data-window]", start: "top 85%" } });
    },
    { scope: root }
  );

  return (
    <section ref={root} id="replay" aria-labelledby="replay-title" className="page-x relative py-[16vh] max-md:py-24">
      <SectionHead
        id="replay-title"
        title={
          <>
            Watch a run,
            <br />
            start to finish
          </>
        }
        aside={run.source === "live" ? "Your latest finished task on this server, replayed from its event log." : <>
            Recorded from <code className="font-mono text-fg-2">npm run demo</code> with the scripted model. Same events, same derivations as the app's run view.
          </>}
      />

      <div data-window className="mx-auto mt-12 max-w-[1080px]">
        <ReplayWindow run={run} ms={p.ms} />

        <div className="mt-4 flex flex-wrap items-center gap-3" role="group" aria-label="Replay controls">
          <button type="button" onClick={p.playing ? p.pause : p.play} className="grid size-9 place-items-center rounded-full bg-fg text-on-fg transition-transform active:scale-95" aria-label={p.playing ? "Pause replay" : "Play replay"}>
            {p.playing ? (
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                <path d="M5 3.5v9M11 3.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="size-3.5 translate-x-px" aria-hidden>
                <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button type="button" onClick={p.restart} className="h-9 rounded-full border border-line-2 px-3.5 text-[13px] text-fg-2 transition-colors hover:text-fg">
            Restart
          </button>
          <label className="order-last flex w-full min-w-0 items-center gap-3 sm:order-none sm:w-auto sm:flex-1">
            <span className="sr-only">Position in the run</span>
            <input
              type="range"
              min={0}
              max={run.duration}
              step={50}
              value={Math.round(p.ms)}
              onChange={(e) => {
                p.pause();
                p.seek(Number(e.target.value));
              }}
              aria-valuetext={`${fmtClock(p.ms)} of ${fmtClock(run.duration)}`}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-line-2 accent-white [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fg"
              style={{ backgroundImage: `linear-gradient(to right, var(--fg) ${(p.ms / run.duration) * 100}%, transparent 0)` }}
            />
            <span className="shrink-0 whitespace-nowrap text-right font-mono text-[11px] text-mute tabular">
              {fmtClock(p.ms)} / {fmtClock(run.duration)}
            </span>
          </label>
          <div className="flex rounded-full border border-line-2 p-0.5" role="radiogroup" aria-label="Playback speed">
            {[0.5, 1, 2].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={speed === s} onClick={() => setSpeed(s)} className={cn("h-7 rounded-full px-2.5 font-mono text-[11px] transition-colors", speed === s ? "bg-s3 text-fg" : "text-dim hover:text-mute")}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
