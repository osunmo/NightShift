import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { fmtClock } from "@/lib/format";
import { ROLES } from "../data/content";
import { STORY } from "../lib/story";
import { MEASE, gsap, useGSAP } from "../lib/motion";
import { DiagnosisBlock, Frame, LogList, PlanBlock, VerdictBlock } from "../components/panels";

type RoleId = (typeof ROLES)[number]["id"];

/** What each role actually produced in the recorded run. */
const PREVIEW: Record<RoleId, () => ReactNode> = {
  orchestrator: () => (
    <div className="flex flex-col gap-3">
      <Frame name="plan">
        <PlanBlock />
      </Frame>
      <Frame name="decisions">
        <div className="t-code">
          {STORY.evaluations.map((e, i) => (
            <div key={i} className="flex min-w-0 gap-3">
              <span className="shrink-0 text-dim tabular">{fmtClock(e.at)}</span>
              <span className="shrink-0 text-fg">#{e.attempt.index}</span>
              <span className={cn("shrink-0", e.decision === "send-to-debugger" ? "text-accent" : "text-ok")}>{e.decision}</span>
              <span className="truncate text-mute">{e.reason}</span>
            </div>
          ))}
        </div>
      </Frame>
    </div>
  ),
  coder: () => (
    <Frame name={`coder · attempt ${STORY.a2.index} · ${STORY.a2.strategy.name}`}>
      <LogList lines={STORY.lines.coder2} />
    </Frame>
  ),
  qa: () => (
    <div className="flex flex-col gap-3">
      <Frame name={`qa-1 · attempt ${STORY.a1.index}`}>
        <LogList lines={STORY.lines.qa1.filter((l) => l.kind === "call" || l.kind === "say")} />
      </Frame>
      <Frame name="verdict">
        <VerdictBlock v={STORY.rejected} />
      </Frame>
    </div>
  ),
  debugger: () => (
    <div className="flex flex-col gap-3">
      <Frame name={`debugger-1 · attempt ${STORY.a1.index}`}>
        <LogList lines={STORY.lines.debugger.filter((l) => l.kind !== "steer").slice(-6)} />
      </Frame>
      <Frame name="diagnosis">
        <DiagnosisBlock />
      </Frame>
    </div>
  ),
  sandbox: () => (
    <Frame name="workspaces" meta={STORY.recordedWith?.split(", ").pop()}>
      <div className="t-code flex flex-col gap-2">
        {STORY.attempts.map((a) => (
          <div key={a.id}>
            <div className="text-fg">
              #{a.index} {a.strategy.name}
            </div>
            <div className="text-mute">worktree on {a.branch}</div>
          </div>
        ))}
        <div className="mt-1 border-t border-line pt-2 text-dim">
          NIGHTSHIFT_SANDBOX=kubernetes gives each attempt its own pod;
          <br />
          NIGHTSHIFT_K8S_RUNTIME_CLASS=kata makes that pod a QEMU microVM.
        </div>
      </div>
    </Frame>
  ),
  pr: () => (
    <Frame name={STORY.pr.dryRun ? "pull request · dry run (no token)" : "pull request"}>
      <div className="flex flex-col gap-2 text-[12.5px] leading-snug">
        <div className="font-display text-[17px] tracking-[-0.01em] text-fg">{STORY.pr.title}</div>
        <div className="font-mono text-[10.5px] text-mute">{STORY.winner.branch}</div>
        <p className="text-fg-2">
          Strategy <span className="font-mono text-fg">{STORY.winner.strategy.name}</span>. {STORY.winnerReason}
        </p>
        <table className="t-code mt-1 w-full text-left">
          <thead className="text-dim">
            <tr>
              <th className="font-normal">#</th>
              <th className="font-normal">strategy</th>
              <th className="font-normal">score</th>
              <th className="font-normal">fix rounds</th>
            </tr>
          </thead>
          <tbody className="text-fg-2">
            {STORY.attempts.map((a) => (
              <tr key={a.id}>
                <td>{a.index}</td>
                <td>{a.strategy.name}</td>
                <td>{a.score}</td>
                <td>{a.fixRounds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  ),
};

export function Roles() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState<RoleId>("orchestrator");
  const role = ROLES.find((r) => r.id === active)!;

  useGSAP(
    () => {
      gsap.from("[data-reveal]", { y: 30, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: root.current, start: "top 70%" } });
      gsap.from("[data-role-item]", { y: 24, opacity: 0, duration: 1, ease: "expo.out", stagger: 0.06, scrollTrigger: { trigger: "[data-role-list]", start: "top 80%" } });
    },
    { scope: root }
  );

  return (
    <section ref={root} id="roles" aria-labelledby="roles-title" className="page-x relative py-[16vh] max-md:py-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-8 [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          <h2 id="roles-title" className="t-h2" data-reveal>
            One run,
            <br />
            every role
          </h2>
          <p className="t-body max-w-[34ch]" data-reveal>
            Four agents and the machinery around them. Pick one to see what it did in a real run.
          </p>
        </div>

        {/* Preview: old one leaves, new one enters, details follow in sync */}
        <div className="order-last min-w-0 lg:order-none" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: MEASE }}
              className="flex flex-col gap-5"
            >
              <div className="min-h-[300px]">{PREVIEW[active]()}</div>
              <div className="grid gap-3 border-t border-line pt-5 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="t-label mb-2">{role.name}</div>
                  <p className="text-[14px] leading-relaxed text-fg-2">{role.does}</p>
                </div>
                <div className="font-mono text-[10.5px] text-dim sm:text-right">{role.note}</div>
                <ul className="flex flex-wrap gap-1.5 sm:col-span-2" aria-label={`${role.name} tools and settings`}>
                  {role.tools.map((t) => (
                    <li key={t} className="rounded-[4px] border border-line bg-s1 px-1.5 py-0.5 font-mono text-[10.5px] text-mute">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <ul data-role-list className="flex flex-col border-t border-line" aria-label="Roles">
          {ROLES.map((r, i) => (
            <li key={r.id} data-role-item className="border-b border-line">
              <button
                type="button"
                aria-pressed={active === r.id}
                onMouseEnter={() => setActive(r.id)}
                onFocus={() => setActive(r.id)}
                onClick={() => setActive(r.id)}
                className="group flex w-full items-baseline gap-4 py-3.5 text-left"
              >
                <span aria-hidden className={cn("font-mono text-[11px] tabular transition-colors duration-300", active === r.id ? "text-fg" : "text-dim")}>{String(i + 1).padStart(2, "0")}</span>
                <span className={cn("t-list transition-[color,transform] duration-500 ease-[cubic-bezier(.16,1,.3,1)]", active === r.id ? "translate-x-1 text-fg" : "text-dim group-hover:text-mute")}>{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
