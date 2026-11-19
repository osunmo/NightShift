import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";
import { Roles } from "./sections/Roles";
import { Workflow } from "./sections/Workflow";
import { Replay } from "./sections/Replay";
import { Faq, Principles } from "./sections/Principles";
import { Closing } from "./sections/Closing";
import { Ruler } from "./components/Ruler";

export function HomePage() {
  return (
    <div className="relative">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-full focus:bg-fg focus:px-4 focus:py-2 focus:text-on-fg">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Features />
        <Roles />
        <Workflow />
        <Replay />
        <Principles />
        <Faq />
      </main>
      <Closing />
      <Ruler />
    </div>
  );
}
