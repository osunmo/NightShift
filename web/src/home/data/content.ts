// Homepage copy. Every claim maps to code in this repository; the file each one comes from is noted.

export const NAV = [
  { href: "#features", label: "Features" },
  { href: "#roles", label: "Roles" },
  { href: "#workflow", label: "Workflow" },
  { href: "#replay", label: "Replay" },
  { href: "#faq", label: "FAQ" },
];

export const HERO = {
  lines: ["Hand off the task.", "Wake up to the PR."],
  after: ["Two attempts.", "One reviewed PR."],
  lead: "Nightshift runs several coding agents on one task, has a separate QA agent check every change, sends rejected work to a debugger, and opens the pull request that survives.",
};

// src/agents/orchestrator.ts, src/git/workspace.ts, src/store/db.ts (inbox), src/setup/env.ts
export const FEATURES = [
  {
    id: "parallel",
    title: "Several attempts, at once",
    body: "The orchestrator plans a different strategy for each attempt and runs them side by side, each in its own git worktree, branch and sandbox.",
  },
  {
    id: "review",
    title: "Reviewed before the PR",
    body: "A QA agent with read-only tools reviews every diff and runs the tests. The orchestrator then re-runs the suite itself, so a QA pass never outvotes red tests.",
  },
  {
    id: "debug",
    title: "Rejected work gets a debugger",
    body: "A failed review goes to a debugger that reproduces the failure, finds the root cause and fixes it. Then QA reviews again, for up to two rounds per attempt.",
  },
  {
    id: "steer",
    title: "Steer without restarting",
    body: "Message one attempt or all of them. Every running agent reads its inbox before its next step, keeps its work, and adjusts.",
  },
  {
    id: "setup",
    title: "Set up once",
    body: "Nightshift detects how to install and test the repo, then caches installed dependencies keyed by a hash of the lockfiles. Later attempts restore instead of reinstalling.",
  },
] as const;

// src/tools/index.ts: the toolset each role is given.
export const ROLES = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    does: "Plans strategies, runs the attempts, answers blocked agents, decides accept, debug or give up, picks the winner and opens the PR.",
    tools: ["plan", "evaluate", "re-run tests", "open PR"],
    note: "Coordinates; never edits code.",
  },
  {
    id: "coder",
    name: "Coder",
    does: "Works one strategy in its own worktree, reporting progress back to the orchestrator as it goes.",
    tools: ["list_dir", "read_file", "grep", "write_file", "search_replace", "delete_file", "run_command", "report", "finish"],
    note: "One per attempt, all in parallel.",
  },
  {
    id: "qa",
    name: "QA",
    does: "Reads the diff, runs the tests and submits a verdict with a score and concrete problems.",
    tools: ["list_dir", "read_file", "grep", "run_command", "view_diff", "report", "submit_verdict"],
    note: "Read-only. It cannot edit files.",
  },
  {
    id: "debugger",
    name: "Debugger",
    does: "Reproduces a rejected change, finds the root cause, fixes it and hands it back to QA.",
    tools: ["list_dir", "read_file", "grep", "write_file", "search_replace", "delete_file", "run_command", "view_diff", "report", "submit_diagnosis"],
    note: "Up to two rounds per attempt.",
  },
  {
    id: "sandbox",
    name: "Sandbox",
    does: "Each attempt runs locally, in its own Docker container, or as its own Kubernetes pod, with the workspace mounted, CPU and memory limits, and optionally no network. With Kata Containers, every pod is a microVM with its own kernel.",
    tools: ["NIGHTSHIFT_SANDBOX=kubernetes", "NIGHTSHIFT_K8S_RUNTIME_CLASS=kata", "NIGHTSHIFT_SANDBOX=docker", "nightshift doctor"],
    note: "src/sandbox/",
  },
  {
    id: "pr",
    name: "Pull request",
    does: "The winning branch is pushed and a PR opened with the task, the strategy, QA's verdict and the test output. Without a token, the branch is left ready.",
    tools: ["GITHUB_TOKEN"],
    note: "src/git/github.ts",
  },
] as const;

// The orchestrator's actual sequence (Orchestrator.runTask).
export const STEPS = [
  { id: "brief", short: "Brief", title: "Describe the task", body: "A prompt, a repository and how many attempts to run. From the app, the CLI or the API." },
  { id: "plan", short: "Plan", title: "Plan the attempts", body: "The orchestrator detects how to test the repo and gives each attempt a different strategy." },
  { id: "attempt", short: "Attempt", title: "Work in parallel", body: "Each coder works its strategy in its own worktree and reports progress back as it goes." },
  { id: "review", short: "Review", title: "Review every change", body: "QA reads each diff and runs the tests. The orchestrator re-runs them to confirm." },
  { id: "repair", short: "Repair", title: "Repair what failed", body: "A rejected attempt goes to the debugger, then back to QA. Passing work waits." },
  { id: "ship", short: "Ship", title: "Ship the best one", body: "The orchestrator compares the attempts that passed, picks one and opens the pull request." },
] as const;

export const PRINCIPLES = [
  { title: "Tests are the ground truth", body: "Agents can be persuaded. A failing test suite can't. Every verdict is checked against a fresh test run." },
  { title: "Every attempt is isolated", body: "Separate worktrees, branches and sandboxes. A bad attempt can't break a good one." },
  { title: "Everything is on the record", body: "Each step is an event. The app, the CLI, the PR description and the eval all read the same log." },
];

// README.md and src/config.ts.
export const FAQ = [
  {
    q: "Which models does it use?",
    a: "Anthropic, OpenAI or OpenRouter, picked from whichever API key is set. NIGHTSHIFT_MODEL overrides the default model.",
  },
  {
    q: "Where does the code run?",
    a: "In a sandbox per attempt: local for development, a Docker container, or a Kubernetes pod. With Kata Containers each pod is a QEMU microVM with its own kernel. `nightshift doctor` checks the sandbox and reports how isolated it is.",
  },
  {
    q: "Does it open pull requests on its own?",
    a: "When GITHUB_TOKEN is set and the repo is on GitHub. Otherwise the winning branch is left ready and the PR description is shown in the app and CLI.",
  },
  {
    q: "How do I know a fix is actually correct?",
    a: "Run the eval: ten small repos with planted bugs, visible tests for the agents and hidden tests only the harness runs on the shipped branch.",
  },
  {
    q: "Has it been benchmarked against a real model?",
    a: "Not yet. Everything is tested end to end with a scripted model (44 automated tests). With an API key, `npm run eval` is the first thing to run.",
  },
  {
    q: "Can I try it without an API key?",
    a: "Yes. `npm run demo` starts a scripted demo model, seeds a task history, and serves the app.",
  },
];
