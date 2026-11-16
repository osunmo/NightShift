# Nightshift

A background coding agent for developers who want to hand off bug fixes and small features, step away, and come back to a reviewed pull request.

You describe a task. An **orchestrator** agent plans a few different approaches and runs a **coder** agent for each one in parallel, each in its own sandbox and git branch. Every coder reports progress back to the orchestrator. When a coder finishes, an independent **QA** agent checks the work. If QA finds problems, a **debugging** agent finds the root cause and fixes it, and QA checks again. The orchestrator then compares the attempts that passed, picks the best one, and opens a pull request that explains what was done and how it was verified.

You can steer the agents while they work, pause them, or pick a different attempt to ship.

```
                       ┌─────────────────────────────┐
   you ── task ──────▶ │        Orchestrator          │ ◀── steer / pause / pick winner
                       │ plan · unblock · evaluate    │
                       └──┬──────────┬──────────┬────┘
              strategy 1  │          │          │  strategy N        (parallel, own branch + sandbox)
                     ┌────▼───┐ ┌────▼───┐ ┌────▼───┐
                     │ Coder  │ │ Coder  │ │ Coder  │ ── report(progress | blocked | done) ──▶ orchestrator
                     └────┬───┘ └────┬───┘ └────┬───┘
                     ┌────▼───┐      ...       ...
                     │   QA   │ ── verdict ──▶ orchestrator (also runs the tests itself)
                     └────┬───┘
                  fail?   │
                     ┌────▼─────┐
                     │ Debugger │ ── diagnosis ──▶ orchestrator ──▶ back to QA (max 2 rounds)
                     └──────────┘
                                  winner ──▶ commit ──▶ push ──▶ pull request
```

## What is in here

| Piece | What it does | Where |
|---|---|---|
| Orchestrator | Plans strategies, runs children in parallel, answers blocked children with guidance, decides accept / send to debugger / give up, picks the winner, opens the PR | `src/agents/orchestrator.ts` |
| Coder, QA, Debugger | One shared agent loop, three roles with different tools and prompts. QA cannot edit files. | `src/agents/loop.ts`, `src/agents/prompts.ts`, `src/tools/index.ts` |
| Steering | Messages go into an inbox that every running agent checks before each step, so the agent keeps its work and adjusts | `Store.drainInbox`, `runAgent` |
| Self review | QA verdict plus the orchestrator re-running the test suite itself. A QA "pass" never overrides red tests or an empty diff. | `Orchestrator.runQA` |
| Parallel attempts | One git worktree, branch and sandbox per attempt, all running at once | `src/git/workspace.ts` |
| Fast setup | Detects the install command, then caches installed dependencies keyed by a hash of the lockfiles. Later attempts and tasks restore the cache instead of reinstalling. | `src/setup/env.ts` |
| Sandboxes | `local` (fast, for development) or `docker` (one container per attempt, workspace mounted, CPU/memory limits, optional no network) | `src/sandbox/` |
| Event log | Every step is an event in SQLite. The UI, CLI, PR description and eval all read from it. | `src/store/db.ts`, `src/bus.ts` |
| Web UI | Prompt composer, a dark agent chat panel where the team reports and you steer, attempt cards with pipeline progress, and Activity / Diff / PR tabs. Fonts (Onest, IBM Plex Mono, OFL) are bundled so it works offline. | `web/index.html` |
| Eval set | 10 small repos with planted bugs, visible tests for the agents and hidden tests for grading, each validated against a reference fix | `src/eval/` |

## Quick start

Requires Node 22.13+ and git. Docker is optional.

```bash
npm install

# Try the UI with no API key (a scripted model plays a realistic run on a demo repo)
npm run demo
# open http://localhost:4100, paste the demo repo path it prints, 2 attempts, any prompt

# Real runs
cp .env.example .env     # add ANTHROPIC_API_KEY (or OPENAI_API_KEY / OPENROUTER_API_KEY)
set -a; source .env; set +a
npm start                # web UI at http://localhost:4100

# Or from the terminal
npm run cli -- run --repo https://github.com/you/repo --attempts 2 "Fix the off-by-one in pagination and add a test"
npm run cli -- run --repo ./some/local/repo --no-pr "..."
```

PRs are opened when `GITHUB_TOKEN` is set (needs `repo` scope) and the repo is a GitHub URL. Otherwise the branch is left ready and the PR description is shown in the UI and CLI.

## Configuration

All settings are environment variables; see `.env.example`.

- `NIGHTSHIFT_PROVIDER` is `anthropic`, `openai` or `openrouter` (picked automatically from whichever key is set). `NIGHTSHIFT_MODEL` overrides the model.
- `NIGHTSHIFT_SANDBOX=docker` runs each attempt in a container. `NIGHTSHIFT_DOCKER_IMAGE` (default `node:22-bookworm`) should contain the toolchains your repos need. `NIGHTSHIFT_DOCKER_NETWORK=none` cuts network access for the agents.
- A repo can add `.nightshift.json` to override detection:

```json
{ "setup": "pnpm install --frozen-lockfile", "test": "pnpm test", "cachePaths": ["node_modules"], "lockfiles": ["pnpm-lock.yaml"] }
```

## Measuring it

```bash
npm run eval                          # every fixture, with and without self review
npm run eval -- --attempts 2 --modes review --only py-retry,js-dates
```

Each fixture has visible tests the agents can run and a hidden test only the harness runs on the shipped branch, so "solved" means actually correct, not "made the visible tests green". Results are written to `eval-results/` as JSON and a markdown table comparing modes. The fixtures are checked by `test/fixtures.test.ts`: the planted bug must fail the hidden test and the reference fix must pass both.

## Tests

```bash
npm test            # 26 tests, no network or API key needed
npm run typecheck
NIGHTSHIFT_TEST_DOCKER=1 npm test   # also run the Docker sandbox test
```

The pipeline tests drive the real orchestrator, git, sandboxes and tools with a scripted model. They cover the QA, debugger and QA loop, QA never overriding failing tests, parallel attempts with winner selection and user override, steering reaching a running agent, a blocked child getting orchestrator guidance, pause, resume and cancel, the dependency cache across attempts and tasks, tool safety, the HTTP API with SSE, provider wire formats, and the eval harness itself.

## Status and next steps

- Everything above runs and is tested with a scripted model. It has not yet been run against a real model. The first thing to do with an API key is `npm run eval`, then tune the prompts in `src/agents/prompts.ts` against the results.
- Long tasks will need context trimming (summarize old tool output) before they hit the model's context limit.
- Next features: start tasks from a GitHub issue label or webhook, screenshots for frontend changes in the PR, token and cost limits per task, Postgres instead of SQLite for multi-user deployments.

## License

MIT
