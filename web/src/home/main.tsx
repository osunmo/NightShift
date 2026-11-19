import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./home.css";
import { HomePage } from "./HomePage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Respect the OS "reduce motion" setting for every Motion animation on the page. */}
    <MotionConfig reducedMotion="user">
      <HomePage />
    </MotionConfig>
  </StrictMode>
);
