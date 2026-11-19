// One motion vocabulary for the whole page: GSAP + ScrollTrigger for choreography and scroll,
// Motion only for small UI state changes. Scrolling itself is native, so the page answers the
// wheel or trackpad immediately.
import { useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/** Expo-out, the page's single easing curve. */
export const EASE = "expo.out";
export const EASE_IO = "power3.inOut";
/** Same curve for Motion (cubic-bezier approximation of expo.out). */
export const MEASE = [0.16, 1, 0.3, 1] as const;

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useReduced() {
  const [r, setR] = useState(reducedMotion);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

/** In-page navigation that keeps the URL hash and moves focus for keyboard users. */
export function scrollToHash(hash: string) {
  const el = document.querySelector<HTMLElement>(hash);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
  history.replaceState(null, "", hash);
  el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

export function scrollToY(y: number) {
  window.scrollTo({ top: y, behavior: reducedMotion() ? "auto" : "smooth" });
}

export { gsap, ScrollTrigger, SplitText, useGSAP };
