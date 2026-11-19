# Nightshift architecture and deployment

[Back to the project overview](../README.md)

## Orchestration

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

## Components

| Piece | What it does | Where |
|---|---|---|
| Orchestrator | Plans strategies, runs children in parallel, answers blocked children with guidance, decides accept / send to debugger / give up, picks the winner, opens the PR | `src/agents/orchestrator.ts` |
| Coder, QA, Debugger | One shared agent loop, three roles with different tools and prompts. QA cannot edit files. | `src/agents/loop.ts`, `src/agents/prompts.ts`, `src/tools/index.ts` |
| Steering | Messages go into an inbox that every running agent checks before each step, so the agent keeps its work and adjusts | `Store.drainInbox`, `runAgent` |
| Self review | QA verdict plus the orchestrator re-running the test suite itself. A QA "pass" never overrides red tests or an empty diff. | `Orchestrator.runQA` |
| Parallel attempts | One git worktree, branch and sandbox per attempt, all running at once | `src/git/workspace.ts` |
| Fast setup | Detects the install command, then caches installed dependencies keyed by a hash of the lockfiles. Later attempts and tasks restore the cache instead of reinstalling. | `src/setup/env.ts` |
| Sandboxes | `local` (fast, for development), `docker` (one container per attempt, workspace mounted, CPU/memory limits, optional no network, optional gVisor or Kata runtime) or `kubernetes` (one pod per attempt, hardened spec, network policies, optional Kata Containers microVMs with their own kernel). `nightshift doctor` checks a sandbox and reports how isolated it is | `src/sandbox/`, `src/doctor.ts`, `deploy/` |
| Event log | Every step is an event in SQLite. The UI, CLI, PR description and eval all read from it. | `src/store/db.ts`, `src/bus.ts` |
| Web UI | React app: searchable task list, a CI-style run view (jobs, grouped logs, trace waterfall, diff, PR), an inspector with attempt details and the team conversation, steering composer, command palette | `web/` |
| Eval set | 10 small repos with planted bugs, visible tests for the agents and hidden tests for grading, each validated against a reference fix | `src/eval/` |

## Web UI

The UI lives in `web/` (React, Vite, Tailwind CSS v4) and is served by the Nightshift server from `web/dist`. There are two entries: the marketing homepage at `/` (`web/src/home/`) and the application at `/app/` (`web/app/index.html`, `web/src/app/`). Old `/#/tasks/...` links redirect to `/app/#/tasks/...`.

The homepage tells its story with a real run recorded from `npm run demo` (`web/src/home/data/recorded-run.json`); every panel on it is rendered from those events with the app's own derivations (`web/src/lib/model.ts`). Served by a Nightshift server with history, the replay section switches to your latest finished task. Motion uses GSAP with ScrollTrigger and SplitText and Motion for small UI transitions, over native scrolling; all of it is disabled under `prefers-reduced-motion`. The homepage has dark and light themes and shares the theme setting with the app (`localStorage` key `ns.theme`). Type is Inter Tight, Geist and Geist Mono (SIL OFL). The homepage has its own stylesheet, so it never touches the app's styles.

- **Tasks:** searchable and filterable list with each task's attempts at a glance (`/` to search, `C` for a new task, `⌘K` for the command palette).
- **Run view:** a job list (plan, every attempt with its coder / QA / debugger runs, evaluation, PR), grouped logs with timestamps, exit codes, expandable tool output and search, a trace waterfall of all agent runs with your steering messages marked on the timeline, a side-by-side attempt comparison, a diff viewer, and the PR description the orchestrator wrote.
- **Inspector:** attempt details (branch, score, tests, fix rounds, setup, QA reviews, diagnoses) and the team conversation, with a composer to steer one attempt or all of them. Pause, resume, cancel and "ship this attempt instead" are one click.
- Light and dark themes. Selection lives in the URL, so every view is linkable.

Components come from [shadcn/ui](https://ui.shadcn.com) (copied from the official registry into `web/src/components/ui`). The copy button is [@ncdai/copy-button](https://21st.dev/@ncdai/components/copy-button) from 21st.dev, with its sound and haptic feedback removed.

```bash
npm run dev            # API server on :4100
npm run dev:web        # UI with hot reload on :5173, proxies /api to :4100
npm run build:web      # production build into web/dist
```

## Configuration

Server configuration is available in [`.env.example`](../.env.example). The web Settings page also supports GitHub App installation, encrypted model keys, and browser-scoped task preferences.

- `NIGHTSHIFT_PROVIDER` is `anthropic`, `openai` or `openrouter` (picked automatically from whichever key is set). `NIGHTSHIFT_MODEL` overrides the model.
- `NIGHTSHIFT_SANDBOX=docker` runs each attempt in a container. `NIGHTSHIFT_DOCKER_IMAGE` (default `node:22-bookworm`) should contain the toolchains your repos need. `NIGHTSHIFT_DOCKER_NETWORK=none` cuts network access for the agents. `NIGHTSHIFT_DOCKER_RUNTIME=runsc` (gVisor) or `=kata` (Kata Containers) gives each container its own kernel, if that runtime is installed.
- `NIGHTSHIFT_SANDBOX=kubernetes` runs each attempt as a pod (`kubectl` must reach the cluster). With `NIGHTSHIFT_K8S_RUNTIME_CLASS=kata` every pod is a QEMU microVM. The attempt's worktree is mounted into the pod, so Nightshift runs on the node (single-node k3s) or keeps `NIGHTSHIFT_HOME` on a shared volume (`NIGHTSHIFT_K8S_VOLUME=pvc:<claim>`). [deploy/vm/](../deploy/vm/) sets all of this up on an Azure or Oracle Cloud VM in one script ([AZURE.md](../deploy/vm/AZURE.md), [ORACLE.md](../deploy/vm/ORACLE.md)). Run `npm run cli -- doctor` to check any sandbox.
- `NIGHTSHIFT_HOST` (default `127.0.0.1`) is the address the server listens on. On a server, reach it through an SSH tunnel, or set `0.0.0.0` together with `NIGHTSHIFT_API_TOKEN`.
- A repo can add `.nightshift.json` to override detection:

```json
{ "setup": "pnpm install --frozen-lockfile", "test": "pnpm test", "cachePaths": ["node_modules"], "lockfiles": ["pnpm-lock.yaml"] }
```

### GitHub App repository access

Register a **private GitHub App** for this Nightshift instance. Grant repository **Metadata: read**, **Contents: read and write**, and **Pull requests: read and write** access. Leave webhooks and user authorization disabled. Generate a private key and place the PEM outside the repository on the Nightshift server. Set `NIGHTSHIFT_GITHUB_APP_SLUG`, `NIGHTSHIFT_GITHUB_APP_ID`, and `NIGHTSHIFT_GITHUB_APP_PRIVATE_KEY_FILE` and restart Nightshift.

In **Settings → GitHub**, choose **Install on GitHub** and select the repositories to grant. Return to Nightshift, refresh the list, then connect the desired account or organization. A connection is shared by users of this Nightshift instance. Nightshift uses short-lived, repository-scoped installation tokens to clone private repositories, push branches and checkpoints, and open pull requests. If you previously installed the app with metadata-only access, approve the new permissions for the installation on GitHub. `GITHUB_TOKEN` is optional and can still serve as a fallback for repositories outside the connection.

## Recovery

Nightshift is meant to run overnight, so an interruption should not cost the night's work.

- **Server restart or crash.** On startup, unfinished tasks are resumed from their event log and workspaces instead of being marked failed. Each attempt continues at its last recoverable step: an interrupted coder is restarted on the code already on disk and told what it already did; a review or debug round that was cut off is run again; an attempt that had already passed is re-verified against the tests, not reviewed again. A task interrupted while planning starts over. `NIGHTSHIFT_RESUME=0` restores the old behaviour (mark them failed).
- **Lost container or pod.** If an attempt's sandbox disappears mid-command (removed, evicted, node lost), a new one is started on the same workspace and the command runs again, up to 3 times per attempt. Ordinary failing commands are never mistaken for this: the sandbox is checked before anything is restarted.
- **Checkpoints.** After the coder and after each debugger round, the attempt's code is saved as a commit on a hidden ref, `refs/nightshift/checkpoints/<attempt>`, without touching its branch, index or files. With a connected GitHub App or fallback token, checkpoints are pushed to the repository, so the work also survives the loss of the machine.

All three appear in the run view's logs. Recovering on a different machine (a separate control plane and workers) is the next step; see Status.

## Measuring it

```bash
npm run eval                          # every fixture, with and without self review
npm run eval -- --attempts 2 --modes review --only py-retry,js-dates
```

Each fixture has visible tests the agents can run and a hidden test only the harness runs on the shipped branch, so "solved" means actually correct, not "made the visible tests green". Results are written to `eval-results/` as JSON and a markdown table comparing modes. The fixtures are checked by `test/fixtures.test.ts`: the planted bug must fail the hidden test and the reference fix must pass both.

## Tests

```bash
npm test            # no model API key needed
npm run typecheck   # server and web app
NIGHTSHIFT_TEST_DOCKER=1 npm test   # also run the Docker sandbox and the Kubernetes sandbox (against a Docker-backed stand-in kubectl)
NIGHTSHIFT_TEST_K8S=1 node --import tsx --test test/kubernetes.test.ts   # against a real cluster
```

The pipeline tests drive the real orchestrator, git, sandboxes and tools with a scripted model. They cover the QA, debugger and QA loop, QA never overriding failing tests, parallel attempts with winner selection and user override, steering reaching a running agent, a blocked child getting orchestrator guidance, pause, resume and cancel, the dependency cache across attempts and tasks, tool safety, the HTTP API with SSE, provider wire formats, and the eval harness itself.

## Status and next steps

- The demo and pipeline tests use a scripted model. To evaluate a configured model, run `npm run eval` and compare the results across fixtures and review modes.
- Long tasks will need context trimming (summarize old tool output) before they hit the model's context limit.
- Next infrastructure: a cost-aware scheduler (size classes per attempt, measured CPU and memory, admission limits, scaling up an attempt that runs out of memory) with a benchmark of fixed vs tiered vs adaptive sizing; then a separate control plane and worker machines, so an attempt whose machine is lost resumes on another one from its pushed checkpoint, proven with a chaos benchmark.
- Next features: start tasks from a GitHub issue label or webhook, screenshots for frontend changes in the PR, token and cost limits per task, Postgres instead of SQLite for multi-user deployments.
