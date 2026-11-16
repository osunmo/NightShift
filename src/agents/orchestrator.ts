// The orchestrator: plans strategies, runs coder children in parallel, sends each through
// QA -> (debugger -> QA)* rounds, listens to child reports, evaluates, and opens the PR.
import { join } from "node:path";
import type { Bus } from "../bus.ts";
import { addWorktree, cloneBase, commitAll, diffAgainstBase, diffStat, excludePaths, type BaseWorkspace } from "../git/workspace.ts";
import { openPullRequest } from "../git/github.ts";
import { createSandbox, type SandboxMode } from "../sandbox/index.ts";
import type { Sandbox } from "../sandbox/sandbox.ts";
import { detectConfig, prepareEnv, type RepoConfig } from "../setup/env.ts";
import type { Store } from "../store/db.ts";
import type { AttemptRow, EventRow, LLMProvider, QAVerdict, Strategy, TaskRow } from "../types.ts";
import { runAgent, TaskControl } from "./loop.ts";
import * as P from "./prompts.ts";

export interface OrchestratorOptions {
  store: Store;
  bus: Bus;
  provider: LLMProvider;
  home: string; // data directory
  sandboxMode: SandboxMode;
  githubToken?: string;
  dryRunPR?: boolean;
  maxFixRounds?: number; // debugger rounds per attempt
  maxSteps?: { coder: number; qa: number; debugger: number };
  commandTimeoutMs?: number;
  selfReview?: boolean; // false = skip QA/debugger (used by the eval baseline)
  models?: Partial<Record<"orchestrator" | "coder" | "qa" | "debugger", string>>;
}

interface AttemptCtx {
  row: AttemptRow;
  sandbox: Sandbox;
  verdicts: QAVerdict[];
  diagnoses: { root_cause: string; fix: string; fixed: boolean }[];
  coderSummary: string;
}

export class Orchestrator {
  controls = new Map<string, TaskControl>();
  private bases = new Map<string, { base: BaseWorkspace; cfg: RepoConfig }>();
  private attemptCtx = new Map<string, AttemptCtx>();
  o: Required<Omit<OrchestratorOptions, "githubToken" | "models">> & Pick<OrchestratorOptions, "githubToken" | "models">;

  constructor(opts: OrchestratorOptions) {
    this.o = {
      dryRunPR: false,
      maxFixRounds: 2,
      maxSteps: { coder: 40, qa: 20, debugger: 30 },
      commandTimeoutMs: 5 * 60_000,
      selfReview: true,
      ...opts,
    };
  }

  get store(): Store {
    return this.o.store;
  }
  get bus(): Bus {
    return this.o.bus;
  }

  control(taskId: string) {
    let c = this.controls.get(taskId);
    if (!c) this.controls.set(taskId, (c = new TaskControl()));
    return c;
  }

  // ---------- user-facing controls ----------
  steer(taskId: string, text: string, attemptId: string | null = null) {
    this.store.pushInbox(taskId, attemptId, text);
    this.bus.emit(taskId, attemptId, "user", "steer", { text, target: attemptId ?? "all" });
  }
  pause(taskId: string) {
    this.control(taskId).pause();
    this.bus.emit(taskId, null, "user", "task.status", { paused: true });
  }
  resume(taskId: string) {
    this.control(taskId).resume();
    this.bus.emit(taskId, null, "user", "task.status", { paused: false });
  }
  cancel(taskId: string) {
    this.control(taskId).cancel();
    this.setStatus(taskId, "cancelled");
  }

  private setStatus(taskId: string, status: TaskRow["status"]) {
    this.store.updateTask(taskId, { status });
    this.bus.emit(taskId, null, "orchestrator", "task.status", { status });
  }
  private setAttempt(a: AttemptRow, status: AttemptRow["status"], extra: Record<string, any> = {}) {
    this.store.updateAttempt(a.id, { status });
    this.bus.emit(a.taskId, a.id, "orchestrator", "attempt.status", { status, ...extra });
  }

  // ---------- main entry ----------
  async runTask(taskId: string): Promise<TaskRow> {
    const task = this.store.getTask(taskId)!;
    const control = this.control(taskId);
    const unsubscribe = this.bus.onTask(taskId, (e) => this.onChildEvent(task, e));
    const ctxs: AttemptCtx[] = [];
    try {
      // 1. Workspace + config
      this.setStatus(taskId, "planning");
      const taskDir = join(this.o.home, "tasks", taskId);
      const base = await cloneBase(task.repo, task.baseBranch, taskDir, this.o.githubToken);
      const cfg = await detectConfig(base.dir);
      await excludePaths(base, cfg.cachePaths);
      this.bases.set(taskId, { base, cfg });
      this.bus.emit(taskId, null, "orchestrator", "setup", { phase: "config", config: cfg, baseSha: base.baseSha });

      // 2. Plan strategies
      const strategies = await this.plan(task, base);
      if (control.cancelled) return this.store.getTask(taskId)!;

      // 3. Warm the dependency cache once in the base checkout, so every attempt restores it.
      if (cfg.setup) {
        const sb = createSandbox(this.o.sandboxMode, base.dir, `${taskId}-base`);
        await sb.start();
        try {
          const r = await prepareEnv(sb, cfg, this.store, join(this.o.home, "cache"));
          this.bus.emit(taskId, null, "orchestrator", "setup", { phase: "base", ms: r.ms, cached: r.cached, key: r.key });
        } finally {
          await sb.dispose();
        }
      }

      // 4. Spawn children in parallel
      this.setStatus(taskId, "running");
      const rows = strategies.map((s, i) =>
        this.store.createAttempt({
          taskId,
          index: i + 1,
          strategy: s,
          branch: `nightshift/${taskId.slice(2)}-${i + 1}-${slug(s.name)}`,
          workdir: join(taskDir, `attempt-${i + 1}`),
        })
      );
      for (const row of rows) this.bus.emit(taskId, row.id, "orchestrator", "attempt.created", { strategy: row.strategy, branch: row.branch });

      await Promise.all(
        rows.map(async (row) => {
          const ctx = await this.runAttempt(task, row, base, cfg).catch((e) => {
            this.bus.emit(taskId, row.id, "orchestrator", "error", { message: String(e?.message ?? e) });
            this.setAttempt(row, "failed", { reason: "crashed" });
            return null;
          });
          if (ctx) ctxs.push(ctx);
        })
      );
      if (control.cancelled) return this.store.getTask(taskId)!;

      // 5. Evaluate and ship
      this.setStatus(taskId, "evaluating");
      const winner = await this.pickWinner(task, ctxs);
      if (!winner) {
        const summary = "No attempt passed QA. See the attempts for QA findings and debugger diagnoses.";
        this.store.updateTask(taskId, { summary });
        this.bus.emit(taskId, null, "orchestrator", "evaluation", { decision: "no-winner", summary });
        this.setStatus(taskId, "failed");
        return this.store.getTask(taskId)!;
      }
      await this.finalize(taskId, winner.row.id, winner.reason);
      return this.store.getTask(taskId)!;
    } catch (e: any) {
      this.bus.emit(taskId, null, "orchestrator", "error", { message: String(e?.message ?? e) });
      this.store.updateTask(taskId, { summary: String(e?.message ?? e) });
      this.setStatus(taskId, "failed");
      return this.store.getTask(taskId)!;
    } finally {
      unsubscribe();
      await Promise.all(ctxs.map((c) => c.sandbox.dispose().catch(() => {})));
    }
  }

  // ---------- planning ----------
  private async plan(task: TaskRow, base: BaseWorkspace): Promise<Strategy[]> {
    const n = Math.max(1, task.numAttempts);
    if (n === 1) {
      const s = [P.DEFAULT_STRATEGIES[0]];
      this.bus.emit(task.id, null, "orchestrator", "plan", { strategies: s, source: "default" });
      return s;
    }
    const files = (await createSandbox("local", base.dir, "ls").listDir(".")).join("\n");
    let strategies: Strategy[] = [];
    let notes = "";
    try {
      const res = await this.o.provider.chat({
        role: "orchestrator",
        model: this.o.models?.orchestrator,
        messages: [
          { role: "system", content: P.ORCHESTRATOR_SYSTEM },
          { role: "user", content: P.planPrompt(task.prompt, n, files) },
        ],
        tools: [P.ORCHESTRATOR_TOOLS.make_plan],
        meta: { kind: "plan", taskId: task.id },
      });
      const tc = res.toolCalls.find((t) => t.name === "make_plan");
      strategies = (tc?.args.strategies ?? []).filter((s: any) => s?.name && s?.instructions);
      notes = tc?.args.notes ?? "";
    } catch (e: any) {
      this.bus.emit(task.id, null, "orchestrator", "error", { message: `Planning failed, using defaults: ${e.message}` });
    }
    const source = strategies.length ? "model" : "default";
    for (const d of P.DEFAULT_STRATEGIES) if (strategies.length < n && !strategies.some((s) => s.name === d.name)) strategies.push(d);
    strategies = strategies.slice(0, n).map((s) => ({ ...s, instructions: notes ? `${s.instructions}\nNote: ${notes}` : s.instructions }));
    this.bus.emit(task.id, null, "orchestrator", "plan", { strategies, source });
    return strategies;
  }

  // ---------- one child pipeline ----------
  private async runAttempt(task: TaskRow, row: AttemptRow, base: BaseWorkspace, cfg: RepoConfig): Promise<AttemptCtx> {
    const control = this.control(task.id);
    this.setAttempt(row, "setup");
    await addWorktree(base, row.workdir, row.branch);
    const sandbox = createSandbox(this.o.sandboxMode, row.workdir, row.id.replace(/_/g, "-"));
    await sandbox.start();
    const ctx: AttemptCtx = { row, sandbox, verdicts: [], diagnoses: [], coderSummary: "" };
    this.attemptCtx.set(row.id, ctx);

    const setup = await prepareEnv(sandbox, cfg, this.store, join(this.o.home, "cache"));
    this.store.updateAttempt(row.id, { setupMs: setup.ms, setupCached: setup.cached });
    this.bus.emit(task.id, row.id, "orchestrator", "setup", { phase: "attempt", ms: setup.ms, cached: setup.cached, ran: setup.ran });

    const getDiff = () => diffAgainstBase(row.workdir, base.baseSha);
    const common = { taskId: task.id, attemptId: row.id, provider: this.o.provider, sandbox, bus: this.bus, control, getDiff, commandTimeoutMs: this.o.commandTimeoutMs };

    // Coder
    this.setAttempt(row, "coding");
    const coder = await runAgent({
      ...common,
      role: "coder",
      runId: "coder",
      model: row.strategy.model ?? this.o.models?.coder,
      system: P.coderSystem(cfg, row.strategy),
      prompt: P.coderPrompt(task.prompt),
      maxSteps: this.o.maxSteps.coder,
    });
    ctx.coderSummary = coder.result?.args.summary ?? coder.lastText;
    this.bus.emit(task.id, row.id, "coder", "report", {
      status: coder.result ? "done" : "blocked",
      message: coder.result ? ctx.coderSummary : `Coder stopped (${coder.stopped}) without finishing.`,
      runId: "coder",
    });
    if (control.cancelled) return this.done(ctx, "cancelled");

    if (!this.o.selfReview) {
      const t = await this.groundTruthTests(ctx, cfg);
      const pass = !!coder.result && t.passed !== false;
      await this.scoreAttempt(ctx, base, pass ? 5 : 0, t.passed);
      return this.done(ctx, pass ? "passed" : "failed");
    }

    // QA -> debugger rounds
    for (let round = 0; ; round++) {
      this.setAttempt(row, "qa", { round });
      const verdict = await this.runQA(task, ctx, cfg, round);
      ctx.verdicts.push(verdict);
      this.bus.emit(task.id, row.id, "qa", "verdict", { ...verdict, round });

      const decision = verdict.pass ? "accept" : round < this.o.maxFixRounds ? "send-to-debugger" : "give-up";
      this.bus.emit(task.id, row.id, "orchestrator", "evaluation", {
        decision,
        round,
        reason: verdict.pass ? verdict.summary : verdict.problems.join("; ") || verdict.summary,
      });
      if (verdict.pass) {
        await this.scoreAttempt(ctx, base, verdict.score, verdict.testsPassed);
        return this.done(ctx, "passed");
      }
      if (decision === "give-up" || control.cancelled) {
        await this.scoreAttempt(ctx, base, Math.min(verdict.score, 4), verdict.testsPassed);
        return this.done(ctx, control.cancelled ? "cancelled" : "failed");
      }

      this.setAttempt(row, "debugging", { round });
      this.store.updateAttempt(row.id, { fixRounds: round + 1 });
      const dbg = await runAgent({
        ...common,
        role: "debugger",
        runId: `debugger-${round + 1}`,
        model: this.o.models?.debugger,
        system: P.debuggerSystem(cfg),
        prompt: P.debuggerPrompt(task.prompt, verdict),
        maxSteps: this.o.maxSteps.debugger,
      });
      const diag = (dbg.result?.args as any) ?? { root_cause: "(debugger did not submit)", fix: dbg.lastText, fixed: false };
      ctx.diagnoses.push(diag);
      this.bus.emit(task.id, row.id, "debugger", "diagnosis", { ...diag, round: round + 1 });
      this.bus.emit(task.id, row.id, "debugger", "report", {
        status: diag.fixed ? "done" : "blocked",
        message: `Root cause: ${String(diag.root_cause).replace(/\.$/, "")}. Fix: ${diag.fix}`,
        runId: `debugger-${round + 1}`,
      });
    }
  }

  private async runQA(task: TaskRow, ctx: AttemptCtx, cfg: RepoConfig, round: number): Promise<QAVerdict> {
    const control = this.control(task.id);
    const getDiff = () => diffAgainstBase(ctx.row.workdir, this.bases.get(task.id)!.base.baseSha);
    const qa = await runAgent({
      role: "qa",
      runId: `qa-${round + 1}`,
      taskId: task.id,
      attemptId: ctx.row.id,
      provider: this.o.provider,
      model: this.o.models?.qa,
      sandbox: ctx.sandbox,
      bus: this.bus,
      control,
      getDiff,
      commandTimeoutMs: this.o.commandTimeoutMs,
      system: P.qaSystem(cfg),
      prompt: P.qaPrompt(task.prompt, ctx.coderSummary),
      maxSteps: this.o.maxSteps.qa,
    });
    // The orchestrator also runs the tests itself: QA's opinion never overrides a red test suite.
    const truth = await this.groundTruthTests(ctx, cfg);
    const a: any = qa.result?.args ?? {};
    const problems: string[] = Array.isArray(a.problems) ? a.problems.map(String) : [];
    if (!qa.result) problems.push(`QA agent did not submit a verdict (${qa.stopped}).`);
    if (truth.passed === false && !problems.some((p) => /test/i.test(p))) problems.push("Test suite fails (see test output).");
    const emptyDiff = !(await getDiff()).trim();
    if (emptyDiff) problems.push("No changes were made.");
    const pass = !!qa.result && a.pass === true && truth.passed !== false && !emptyDiff;
    return {
      pass,
      score: clamp(Number(a.score ?? 0), 0, 10),
      testsPassed: truth.passed,
      testOutput: truth.output,
      problems,
      summary: String(a.summary ?? qa.lastText ?? ""),
    };
  }

  private async groundTruthTests(ctx: AttemptCtx, cfg: RepoConfig): Promise<{ passed: boolean | null; output: string }> {
    if (!cfg.test) return { passed: null, output: "" };
    const r = await ctx.sandbox.exec(cfg.test, { timeoutMs: this.o.commandTimeoutMs });
    const output = `$ ${cfg.test}\nexit_code: ${r.code}\n${r.stdout}\n${r.stderr}`.slice(-6000);
    this.bus.emit(ctx.row.taskId, ctx.row.id, "orchestrator", "tool.result", { name: "orchestrator_tests", output, error: r.code !== 0 });
    return { passed: r.code === 0, output };
  }

  private async scoreAttempt(ctx: AttemptCtx, base: BaseWorkspace, qaScore: number, tests: boolean | null) {
    const diff = await diffAgainstBase(ctx.row.workdir, base.baseSha);
    const stat = await diffStat(ctx.row.workdir, base.baseSha);
    // 0-10. QA score dominates; passing tests add up to 2; very large diffs and extra fix rounds cost a little.
    const raw =
      qaScore * 0.8 + (tests === true ? 2 : 0) - Math.min(2, (stat.added + stat.removed) / 400) - 0.5 * ctx.diagnoses.length;
    const score = clamp(raw, 0, 10);
    this.store.updateAttempt(ctx.row.id, { diff, score: Math.round(score * 10) / 10 });
    ctx.row = this.store.getAttempt(ctx.row.id)!;
  }

  private done(ctx: AttemptCtx, status: AttemptRow["status"]) {
    this.setAttempt(ctx.row, status, { score: this.store.getAttempt(ctx.row.id)?.score });
    ctx.row = this.store.getAttempt(ctx.row.id)!;
    return ctx;
  }

  // ---------- children -> orchestrator ----------
  private async onChildEvent(task: TaskRow, e: EventRow) {
    if (e.kind !== "report" || e.role !== "coder" || e.data?.status !== "blocked" || !e.attemptId) return;
    if (e.data.runId !== "coder" || /stopped \(/.test(e.data.message)) return; // only live reports from a running coder
    const ctx = this.attemptCtx.get(e.attemptId);
    if (!ctx) return;
    const recent = this.store
      .listEvents(task.id)
      .filter((x) => x.attemptId === e.attemptId && (x.kind === "tool.call" || x.kind === "tool.result"))
      .slice(-8)
      .map((x) => (x.kind === "tool.call" ? `call ${x.data.name} ${JSON.stringify(x.data.args).slice(0, 200)}` : `-> ${String(x.data.output).slice(0, 300)}`))
      .join("\n");
    try {
      const res = await this.o.provider.chat({
        role: "orchestrator",
        model: this.o.models?.orchestrator,
        messages: [
          { role: "system", content: P.ORCHESTRATOR_SYSTEM },
          { role: "user", content: P.unblockPrompt(task.prompt, ctx.row.strategy, e.data.message, recent) },
        ],
        tools: [P.ORCHESTRATOR_TOOLS.send_guidance],
        meta: { kind: "unblock", attemptId: e.attemptId },
      });
      const guidance = res.toolCalls.find((t) => t.name === "send_guidance")?.args.guidance || res.text;
      if (guidance) {
        this.store.pushInbox(task.id, e.attemptId, `Guidance from the orchestrator: ${guidance}`);
        this.bus.emit(task.id, e.attemptId, "orchestrator", "evaluation", { decision: "guidance", reason: guidance });
      }
    } catch (err: any) {
      this.bus.emit(task.id, e.attemptId, "orchestrator", "error", { message: `Could not answer blocked child: ${err.message}` });
    }
  }

  // ---------- evaluation ----------
  private async pickWinner(task: TaskRow, ctxs: AttemptCtx[]): Promise<{ row: AttemptRow; reason: string } | null> {
    const passed = ctxs
      .map((c) => ({ ...c, row: this.store.getAttempt(c.row.id)! }))
      .filter((c) => c.row.status === "passed")
      .sort((a, b) => (b.row.score ?? 0) - (a.row.score ?? 0));
    if (!passed.length) return null;
    if (passed.length === 1) {
      const reason = "Only attempt that passed QA.";
      this.bus.emit(task.id, passed[0].row.id, "orchestrator", "evaluation", { decision: "winner", reason, attemptId: passed[0].row.id });
      return { row: passed[0].row, reason };
    }
    const candidates = passed
      .map(
        (c) =>
          `## ${c.row.id} (strategy: ${c.row.strategy.name}, score ${c.row.score}, fix rounds ${c.row.fixRounds})\nQA: ${
            c.verdicts.at(-1)?.summary
          }\nDiff:\n${(c.row.diff ?? "").slice(0, 3000)}`
      )
      .join("\n\n");
    let pick = passed[0].row.id;
    let reason = "Highest score.";
    try {
      const res = await this.o.provider.chat({
        role: "orchestrator",
        model: this.o.models?.orchestrator,
        messages: [
          { role: "system", content: P.ORCHESTRATOR_SYSTEM },
          { role: "user", content: P.selectPrompt(task.prompt, candidates) },
        ],
        tools: [P.ORCHESTRATOR_TOOLS.select_winner],
        meta: { kind: "select", taskId: task.id },
      });
      const tc = res.toolCalls.find((t) => t.name === "select_winner");
      if (tc && passed.some((c) => c.row.id === tc.args.attempt_id)) {
        pick = tc.args.attempt_id;
        reason = tc.args.reason || reason;
      }
    } catch (e: any) {
      this.bus.emit(task.id, null, "orchestrator", "error", { message: `Selection call failed, using score: ${e.message}` });
    }
    this.bus.emit(task.id, pick, "orchestrator", "evaluation", { decision: "winner", reason, attemptId: pick });
    return { row: this.store.getAttempt(pick)!, reason };
  }

  /** Commit the chosen attempt and open the PR. Also used when the user picks a different attempt. */
  async finalize(taskId: string, attemptId: string, reason = "Selected by user."): Promise<TaskRow> {
    const task = this.store.getTask(taskId)!;
    const attempt = this.store.getAttempt(attemptId)!;
    const all = this.store.listAttempts(taskId);
    const events = this.store.listEvents(taskId).filter((e) => e.attemptId === attemptId);
    const verdict = events.filter((e) => e.kind === "verdict").at(-1)?.data as QAVerdict | undefined;
    const diagnoses = events.filter((e) => e.kind === "diagnosis").map((e) => e.data);
    const setup = events.find((e) => e.kind === "setup" && e.data.phase === "attempt")?.data;

    const title = `Nightshift: ${headline(task.prompt)}`;
    const body = [
      `## Task\n${task.prompt}`,
      `## Result\nStrategy: **${attempt.strategy.name}** (attempt ${attempt.index} of ${all.length}). ${reason}`,
      verdict
        ? `## QA review\n**${verdict.pass ? "Passed" : "Not passed"}**, score ${verdict.score}/10. Tests: ${
            verdict.testsPassed === null ? "no test command" : verdict.testsPassed ? "passing" : "failing"
          }\n\n${verdict.summary}`
        : "## QA review\nSkipped.",
      diagnoses.length
        ? `## Debugging rounds\n${diagnoses.map((d: any, i: number) => `${i + 1}. Root cause: ${d.root_cause}\n   Fix: ${d.fix}`).join("\n")}`
        : "",
      all.length > 1
        ? `## All attempts\n| # | Strategy | Status | Score | Fix rounds |\n|---|---|---|---|---|\n${all
            .map((a) => `| ${a.index} | ${a.strategy.name} | ${a.status} | ${a.score ?? "-"} | ${a.fixRounds} |`)
            .join("\n")}`
        : "",
      setup ? `Setup: ${(setup.ms / 1000).toFixed(1)}s${setup.cached ? " (dependency cache hit)" : ""}` : "",
      verdict?.testOutput ? `<details><summary>Test output</summary>\n\n\`\`\`\n${verdict.testOutput.slice(-3000)}\n\`\`\`\n</details>` : "",
      `\n_Opened by Nightshift._`,
    ]
      .filter(Boolean)
      .join("\n\n");

    await commitAll(attempt.workdir, `${headline(task.prompt)}\n\nNightshift attempt ${attempt.index} (${attempt.strategy.name}).`);
    let pr;
    try {
      pr = await openPullRequest({
        repoUrl: task.repo,
        worktree: attempt.workdir,
        branch: attempt.branch,
        baseBranch: task.baseBranch,
        title,
        body,
        token: this.o.githubToken,
        dryRun: this.o.dryRunPR,
      });
    } catch (e: any) {
      this.bus.emit(taskId, attemptId, "orchestrator", "error", { message: e.message });
      pr = { url: null, dryRun: true, title, body, reason: e.message };
    }
    this.store.updateTask(taskId, {
      winnerAttemptId: attemptId,
      prUrl: pr.url,
      summary: pr.url ? `Opened ${pr.url}` : `Ready on branch ${attempt.branch} (PR not opened: ${pr.reason}).`,
    });
    this.bus.emit(taskId, attemptId, "orchestrator", "pr", pr);
    this.setStatus(taskId, "done");
    return this.store.getTask(taskId)!;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "attempt";
const firstLine = (s: string) => s.trim().split("\n")[0];
/** First sentence of the prompt, or a word-boundary cut, at most ~72 characters. */
export function headline(prompt: string, max = 72): string {
  const line = firstLine(prompt);
  const sentence = line.match(/^(.+?[.!?])(\s|$)/)?.[1];
  if (sentence && sentence.length <= max) return sentence.replace(/[.]$/, "");
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[\s,;:]+$/, "") + "…";
}
const clamp = (n: number, a: number, b: number) => (Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : a);
