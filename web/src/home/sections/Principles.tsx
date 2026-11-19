import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { FAQ, PRINCIPLES } from "../data/content";
import { gsap, MEASE, useGSAP } from "../lib/motion";

/** Inline `code` in plain copy strings. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? (
          <code key={i} className="rounded-[3px] bg-s3 px-1 font-mono text-[0.9em] text-fg-2">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        )
      )}
    </>
  );
}

export function Principles() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      gsap.from("[data-reveal]", { y: 30, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: root.current, start: "top 75%" } });
    },
    { scope: root }
  );
  return (
    <section ref={root} aria-labelledby="principles-title" className="page-x py-[14vh] max-md:py-20">
      <h2 id="principles-title" className="t-h2" data-reveal>
        Built to be
        <br />
        checked
      </h2>
      <div className="mt-14 grid gap-10 border-t border-line pt-8 md:grid-cols-3 md:gap-8">
        {PRINCIPLES.map((p, i) => (
          <div key={p.title} data-reveal>
            <div className="t-label">{String(i + 1).padStart(2, "0")}</div>
            <h3 className="mt-6 font-display text-[22px] leading-tight font-medium tracking-[-0.02em]">{p.title}</h3>
            <p className="t-body mt-3 max-w-[36ch]">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Faq() {
  const root = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<number | null>(0);
  useGSAP(
    () => {
      gsap.from("[data-reveal]", { y: 30, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.06, scrollTrigger: { trigger: root.current, start: "top 75%" } });
    },
    { scope: root }
  );
  return (
    <section ref={root} id="faq" aria-labelledby="faq-title" className="page-x grid gap-10 py-[14vh] max-md:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <h2 id="faq-title" className="t-h2" data-reveal>
        Straight
        <br />
        answers
      </h2>
      <ul className="border-t border-line">
        {FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <li key={f.q} className="border-b border-line" data-reveal>
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-${i}`}
                  id={`faq-q-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-6 py-5 text-left"
                >
                  <span className={cn("font-display text-[20px] leading-snug font-medium tracking-[-0.015em] transition-colors duration-300", isOpen ? "text-fg" : "text-fg-2")}>{f.q}</span>
                  <span className="relative size-3 shrink-0" aria-hidden>
                    <span className="absolute top-1/2 left-0 h-px w-3 bg-fg" />
                    <span className={cn("absolute top-0 left-1/2 h-3 w-px bg-fg transition-transform duration-500", isOpen && "scale-y-0")} />
                  </span>
                </button>
              </h3>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`faq-${i}`}
                    role="region"
                    aria-labelledby={`faq-q-${i}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.5, ease: MEASE }}
                    className="overflow-hidden"
                  >
                    <p className="t-body max-w-[60ch] pb-6">
                      <Rich text={f.a} />
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
