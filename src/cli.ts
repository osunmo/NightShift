// nightshift CLI
//   nightshift serve                         start the web UI + API
//   nightshift demo                          start the UI with a scripted model and a demo repo (no API key)
//   nightshift run --repo <url|path> [--base main] [--attempts 2] [--sandbox local|docker|kubernetes] [--no-pr] "task"
//   nightshift doctor [--sandbox local|docker|kubernetes]   check that sandboxes start and how isolated they are
import "./env.ts";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Bus } from "./bus.ts";
import { Orchestrator } from "./agents/orchestrator.ts";
import { configFromEnv } from "./config.ts";
import { parseSandboxMode } from "./sandbox/index.ts";
import { createGitHubAppSettings } from "./server/github-app-settings.ts";
import { providerFromEnv } from "./llm/index.ts";
import { demoProvider } from "./llm/demo.ts";
import { Store } from "./store/db.ts";
import type { EventRow } from "./types.ts";

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  if (cmd === "serve") return (await import("./server/index.ts")).serve();

  if (cmd === "demo") {
    process.env.NIGHTSHIFT_PROVIDER = "demo";
    const { orch, home } = await (await import("./server/index.ts")).serve();
    const { seedDemo, demoRepo } = await import("./demo/seed.ts");
    const repo = await demoRepo(home, "py-add");
    console.log(`\nDemo repo for a live run: ${repo}`);
    console.log(`Try: "add() returns the wrong result, fix it" with 2 attempts.`);
    seedDemo(orch, home).catch((e) => console.error("Seeding failed:", e.message));
    return;
  }

  if (cmd === "doctor") {
    const { values } = parseArgs({ args: rest, options: { sandbox: { type: "string" } } });
    const mode = values.sandbox ? parseSandboxMode(values.sandbox) : configFromEnv().sandboxMode;
    const { doctor } = await import("./doctor.ts");
    const r = await doctor(mode);
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === "run") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        repo: { type: "string" },
        base: { type: "string", default: "main" },
        attempts: { type: "string", default: "1" },
        sandbox: { type: "string" },
        docker: { type: "boolean", default: false }, // shorthand for --sandbox docker
        "no-pr": { type: "boolean", default: false },
        "no-review": { type: "boolean", default: false },
        demo: { type: "boolean", default: false },
      },
    });
    const prompt = positionals.join(" ").trim();
    if (!values.repo || !prompt) return usage();
    const cfg = configFromEnv();
    const store = new Store(join(cfg.home, "nightshift.db"));
    const bus = new Bus(store);
    const orch = new Orchestrator({
      store,
      bus,
      provider: values.demo ? demoProvider(0) : providerFromEnv(),
      home: cfg.home,
      sandboxMode: values.sandbox ? parseSandboxMode(values.sandbox) : values.docker ? "docker" : cfg.sandboxMode,
      githubToken: cfg.githubToken,
      githubAppToken: values.demo ? undefined : createGitHubAppSettings(cfg.home)?.tokenForRepo,
      dryRunPR: values["no-pr"] || values.demo || cfg.dryRunPR,
      selfReview: !values["no-review"],
    });
    const task = store.createTask({ prompt, repo: values.repo, baseBranch: values.base!, numAttempts: Number(values.attempts) });
    bus.onTask(task.id, printEvent);
    process.on("SIGINT", () => {
      console.log("\nCancelling...");
      orch.cancel(task.id);
    });
    const done = await orch.runTask(task.id);
    console.log(`\n${done.status.toUpperCase()}: ${done.summary ?? ""}`);
    const pr = store.listEvents(task.id).find((e) => e.kind === "pr");
    if (pr && pr.data.dryRun) console.log(`\n--- PR description ---\n${pr.data.body}`);
    process.exit(done.status === "done" ? 0 : 1);
  }
  usage();
}

const C: Record<string, string> = { orchestrator: "35", coder: "34", qa: "32", debugger: "33", user: "37", system: "37" };
function printEvent(e: EventRow) {
  const who = `\x1b[${C[e.role] ?? "37"}m${e.role.padEnd(12)}\x1b[0m${e.attemptId ? e.attemptId.split("_").pop() : "-"} `;
  const d = e.data ?? {};
  let line = "";
  switch (e.kind) {
    case "plan": line = `plan: ${d.strategies.map((s: any) => s.name).join(", ")}`; break;
    case "setup": line = d.phase === "config" ? `setup: ${d.config.setup ?? "none"} | tests: ${d.config.test ?? "none"}` : `setup ${d.phase}: ${(d.ms / 1000).toFixed(1)}s${d.cached ? " (cached)" : ""}`; break;
    case "llm.text": line = d.text.split("\n")[0].slice(0, 140); break;
    case "tool.call": line = `> ${d.name} ${JSON.stringify(d.args).slice(0, 120)}`; break;
    case "tool.result": if (d.error) line = `  ! ${String(d.output).split("\n")[0].slice(0, 140)}`; break;
    case "report": line = `-> orchestrator [${d.status}] ${d.message}`; break;
    case "verdict": line = `QA ${d.pass ? "PASS" : "FAIL"} score=${d.score} tests=${d.testsPassed} ${d.problems.join("; ")}`; break;
    case "diagnosis": line = `diagnosis: ${d.root_cause} | fix: ${d.fix}`; break;
    case "evaluation": line = `decision: ${d.decision} ${d.reason ? "- " + d.reason : ""}`; break;
    case "attempt.status": line = `status -> ${d.status}`; break;
    case "task.status": line = d.status ? `task -> ${d.status}` : d.paused ? "paused" : "resumed"; break;
    case "steer": line = `steer: ${d.text}`; break;
    case "pr": line = d.url ? `PR: ${d.url}` : `PR not opened (${d.reason})`; break;
    case "error": line = `\x1b[31merror: ${d.message}\x1b[0m`; break;
  }
  if (line) console.log(who + line);
}

function usage() {
  console.log(`Usage:
  nightshift serve
  nightshift demo
  nightshift run --repo <github-url|path> [--base main] [--attempts N] [--sandbox local|docker|kubernetes] [--no-pr] [--no-review] [--demo] "task"
  nightshift doctor [--sandbox local|docker|kubernetes]`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
