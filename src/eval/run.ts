// Eval harness: run Nightshift on every fixture, with and without self review, and check the shipped
// branch against hidden tests the agents never saw.
//
//   npm run eval                               # all fixtures, both modes, 1 attempt
//   npm run eval -- --attempts 2 --only py-add,js-dates --modes review
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Bus } from "../bus.ts";
import { Orchestrator } from "../agents/orchestrator.ts";
import { providerFromEnv } from "../llm/index.ts";
import { Store } from "../store/db.ts";
import type { SandboxMode } from "../sandbox/index.ts";
import { cleanEnv, runProcess } from "../sandbox/local.ts";
import type { LLMProvider } from "../types.ts";
import { FIXTURES, makeRepo, type Fixture } from "./fixtures.ts";

export type Mode = "review" | "no-review";

export interface EvalRow {
  fixture: string;
  mode: Mode;
  status: string; // task status
  shipped: boolean; // an attempt was chosen
  solved: boolean; // hidden check passes on the shipped branch
  fixRounds: number;
  seconds: number;
  tokens: number;
}

export interface EvalOptions {
  provider: LLMProvider;
  fixtures?: Fixture[];
  modes?: Mode[];
  attempts?: number;
  sandboxMode?: SandboxMode;
  log?: (s: string) => void;
}

export async function runEval(opts: EvalOptions): Promise<{ rows: EvalRow[]; summary: Record<Mode, { solved: number; total: number; tokens: number }> }> {
  const fixtures = opts.fixtures ?? FIXTURES;
  const modes = opts.modes ?? ["no-review", "review"];
  const log = opts.log ?? (() => {});
  const home = await mkdtemp(join(tmpdir(), "ns-eval-"));
  const store = new Store(join(home, "eval.db"));
  const bus = new Bus(store);
  const rows: EvalRow[] = [];

  for (const mode of modes) {
    const orch = new Orchestrator({
      store,
      bus,
      provider: opts.provider,
      home,
      sandboxMode: opts.sandboxMode ?? "local",
      dryRunPR: true,
      selfReview: mode === "review",
    });
    for (const fx of fixtures) {
      const repo = join(home, "repos", `${fx.name}-${mode}`);
      await makeRepo(repo, fx.files);
      const t0 = Date.now();
      const task = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: opts.attempts ?? 1 });
      const done = await orch.runTask(task.id);
      const winner = done.winnerAttemptId ? store.getAttempt(done.winnerAttemptId) : null;
      let solved = false;
      if (winner) {
        await mkdir(join(winner.workdir), { recursive: true });
        await writeFile(join(winner.workdir, fx.hiddenCheck.file), fx.hiddenCheck.content);
        const r = await runProcess("bash", ["-lc", fx.hiddenCheck.command], { cwd: winner.workdir, env: { ...cleanEnv(), PYTHONDONTWRITEBYTECODE: "1" } }, 120_000);
        solved = r.code === 0;
      }
      const tokens = store
        .listEvents(task.id)
        .filter((e) => e.kind === "usage")
        .reduce((n, e) => n + (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0), 0);
      const row: EvalRow = {
        fixture: fx.name,
        mode,
        status: done.status,
        shipped: !!winner,
        solved,
        fixRounds: winner?.fixRounds ?? 0,
        seconds: Math.round((Date.now() - t0) / 100) / 10,
        tokens,
      };
      rows.push(row);
      log(`${mode.padEnd(9)} ${fx.name.padEnd(20)} ${solved ? "SOLVED" : row.shipped ? "wrong " : "no PR "}  ${row.seconds}s  ${tokens} tok  fix rounds ${row.fixRounds}`);
    }
  }
  const summary = Object.fromEntries(
    modes.map((m) => {
      const r = rows.filter((x) => x.mode === m);
      return [m, { solved: r.filter((x) => x.solved).length, total: r.length, tokens: r.reduce((n, x) => n + x.tokens, 0) }];
    })
  ) as any;
  return { rows, summary };
}

export function toMarkdown(rows: EvalRow[], summary: Record<string, { solved: number; total: number; tokens: number }>): string {
  const modes = Object.keys(summary);
  const names = [...new Set(rows.map((r) => r.fixture))];
  const cell = (r?: EvalRow) => (!r ? "-" : r.solved ? "solved" : r.shipped ? "wrong fix shipped" : "no PR");
  return [
    `| Fixture | ${modes.join(" | ")} |`,
    `|---|${modes.map(() => "---").join("|")}|`,
    ...names.map((n) => `| ${n} | ${modes.map((m) => cell(rows.find((r) => r.fixture === n && r.mode === m))).join(" | ")} |`),
    `| **Solved** | ${modes.map((m) => `**${summary[m].solved}/${summary[m].total}**`).join(" | ")} |`,
    `| Tokens | ${modes.map((m) => summary[m].tokens.toLocaleString()).join(" | ")} |`,
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      attempts: { type: "string", default: "1" },
      only: { type: "string" },
      modes: { type: "string", default: "no-review,review" },
      docker: { type: "boolean", default: false },
    },
  });
  const only = values.only?.split(",");
  const fixtures = only ? FIXTURES.filter((f) => only.includes(f.name)) : FIXTURES;
  const { rows, summary } = await runEval({
    provider: providerFromEnv(),
    fixtures,
    modes: values.modes!.split(",") as Mode[],
    attempts: Number(values.attempts),
    sandboxMode: values.docker ? "docker" : "local",
    log: console.log,
  });
  const md = toMarkdown(rows, summary);
  const outDir = join(process.cwd(), "eval-results");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(join(outDir, `${stamp}.json`), JSON.stringify({ rows, summary }, null, 2));
  await writeFile(join(outDir, `${stamp}.md`), md + "\n");
  console.log("\n" + md + `\n\nSaved to eval-results/${stamp}.{json,md}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => (console.error(e.message), process.exit(1)));
