import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FEATURES } from "../data/content";
import { SectionHead } from "../components/ui";
import { DEMOS } from "../components/demos";
import { gsap, ScrollTrigger, useGSAP, useReduced } from "../lib/motion";

/**
 * Numbered feature plates that stack as you scroll: each one pins under the nav, and the one beneath
 * recedes (scale and dim) as the next slides over it. A plate's demo plays while it is the top plate.
 */
export function Features() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReduced();
  const [active, setActive] = useState(-1);

  useGSAP(
    () => {
      const plates = gsap.utils.toArray<HTMLElement>("[data-plate]");
      plates.forEach((p, i) => {
        ScrollTrigger.create({
          trigger: p,
          start: "top 60%",
          end: "bottom 30%",
          onToggle: (s) => s.isActive && setActive(i),
          onEnterBack: () => setActive(i),
        });
      });
      if (reduced) return;
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", () => {
        plates.forEach((p, i) => {
          const next = plates[i + 1];
          if (!next) return;
          // As the next plate slides up over this one, this one shrinks back and is gone by the time
          // the next plate settles, so nothing is left showing behind it.
          gsap.fromTo(
            p.querySelector("[data-plate-inner]"),
            { scale: 1, opacity: 1 },
            { scale: 0.92, opacity: 0, ease: "none", immediateRender: false, scrollTrigger: { trigger: next, start: "top 85%", end: "top top+=120", scrub: true } }
          );
        });
      });
      gsap.from("[data-reveal]", { y: 30, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: root.current, start: "top 75%" } });
    },
    { scope: root, dependencies: [reduced] }
  );

  return (
    <section ref={root} id="features" aria-labelledby="features-title" className="page-x relative pt-[18vh] pb-[12vh] max-md:pt-24">
      <SectionHead id="features-title" title="What Nightshift does" aside="One task in. Several attempts, an independent review, and one pull request out." />
      <ol className="mt-14 flex flex-col gap-4">
        {FEATURES.map((f, i) => {
          const Demo = DEMOS[f.id];
          return (
            <li key={f.id} data-plate className="lg:sticky" style={{ zIndex: i + 1, top: "calc(var(--nav-h) + 8px)" }}>
              <article
                data-plate-inner
                aria-labelledby={`feat-${f.id}`}
                className="grid origin-top gap-8 overflow-hidden will-change-[transform,opacity] rounded-[10px] [&>*]:min-w-0 border border-line bg-s2 p-5 md:p-8 lg:min-h-[min(580px,calc(100svh-var(--nav-h)-72px))] lg:grid-cols-[72px_minmax(0,1fr)_minmax(0,1.3fr)]"
              >
                <div className="flex lg:block">
                  <span className={cn("grid h-7 min-w-9 place-items-center rounded-[5px] px-2 font-mono text-[11px] tabular transition-colors duration-500", active === i ? "bg-fg text-on-fg" : "bg-s3 text-mute")}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="flex flex-col justify-between gap-6">
                  <h3 id={`feat-${f.id}`} className="t-h3 max-w-[14ch] text-balance">
                    {f.title}
                  </h3>
                  <p className="t-body max-w-[42ch] text-pretty">{f.body}</p>
                </div>
                <div className="grid min-w-0 place-items-center rounded-[8px] border border-line bg-bg/70 p-3 md:p-8 [&>*]:min-w-0">
                  <Demo active={active === i} reduced={reduced} />
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
