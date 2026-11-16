// Tools the agents can call. Each role gets its own toolset:
//  coder    - read, search, edit, run commands, report progress, finish
//  qa       - read, search, run commands, view diff, submit verdict   (no editing)
//  debugger - everything the coder has + view diff, submit diagnosis
import type { Role, ToolSpec } from "../types.ts";
import type { Sandbox } from "../sandbox/sandbox.ts";
import { checkCommand, truncate } from "../sandbox/sandbox.ts";

export interface ToolContext {
  sandbox: Sandbox;
  role: Role;
  getDiff: () => Promise<string>;
  report: (status: "progress" | "done" | "blocked", message: string) => void;
  commandTimeoutMs: number;
  /** Set by terminal tools (finish / submit_verdict / submit_diagnosis). */
  result?: { tool: string; args: Record<string, any> };
}

interface ToolDef extends ToolSpec {
  roles: Role[];
  terminal?: boolean;
  run(args: any, ctx: ToolContext): Promise<string>;
}

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, any>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const TOOLS: ToolDef[] = [
  {
    name: "list_dir",
    description: "List files in a workspace directory (relative path, default '.'). Directories end with '/'.",
    parameters: obj({ path: str("Directory relative to the repo root") }, []),
    roles: ["coder", "qa", "debugger"],
    async run({ path = "." }, ctx) {
      return (await ctx.sandbox.listDir(path)).join("\n") || "(empty)";
    },
  },
  {
    name: "read_file",
    description: "Read a file. Optionally pass start_line/end_line (1-based, inclusive). Output has line numbers.",
    parameters: obj(
      { path: str("File path relative to repo root"), start_line: { type: "integer" }, end_line: { type: "integer" } },
      ["path"]
    ),
    roles: ["coder", "qa", "debugger"],
    async run({ path, start_line, end_line }, ctx) {
      const lines = (await ctx.sandbox.readFile(path)).split("\n");
      const s = Math.max(1, start_line ?? 1);
      const e = Math.min(lines.length, end_line ?? Math.min(lines.length, s + 399));
      const body = lines
        .slice(s - 1, e)
        .map((l, i) => `${String(s + i).padStart(5)}| ${l}`)
        .join("\n");
      const more = e < lines.length ? `\n... (${lines.length - e} more lines, use start_line)` : "";
      return body + more;
    },
  },
  {
    name: "grep",
    description: "Search file contents with a regular expression (grep -E). Returns file:line:text matches.",
    parameters: obj({ pattern: str("Extended regex"), path: str("Directory or file to search (default '.')") }, [
      "pattern",
    ]),
    roles: ["coder", "qa", "debugger"],
    async run({ pattern, path = "." }, ctx) {
      ctx.sandbox.resolvePath(path);
      const r = await ctx.sandbox.exec(
        `grep -rnE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=__pycache__ -I ${shq(
          pattern
        )} ${shq(path)} | head -200`,
        { timeoutMs: 30_000 }
      );
      return r.stdout.trim() || "(no matches)";
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a whole file. Prefer search_replace for edits to existing files.",
    parameters: obj({ path: str("File path"), content: str("Full new file content") }, ["path", "content"]),
    roles: ["coder", "debugger"],
    async run({ path, content }, ctx) {
      await ctx.sandbox.writeFile(path, content);
      return `Wrote ${path} (${content.split("\n").length} lines)`;
    },
  },
  {
    name: "search_replace",
    description:
      "Replace one exact occurrence of old_string with new_string in a file. old_string must match exactly once (include surrounding lines to make it unique).",
    parameters: obj({ path: str("File path"), old_string: str("Exact text to find"), new_string: str("Replacement") }, [
      "path",
      "old_string",
      "new_string",
    ]),
    roles: ["coder", "debugger"],
    async run({ path, old_string, new_string }, ctx) {
      const src = await ctx.sandbox.readFile(path);
      const count = src.split(old_string).length - 1;
      if (count === 0) throw new Error(`old_string not found in ${path}`);
      if (count > 1) throw new Error(`old_string matches ${count} times in ${path}; add more context`);
      await ctx.sandbox.writeFile(path, src.replace(old_string, () => new_string));
      return `Edited ${path}`;
    },
  },
  {
    name: "delete_file",
    description: "Delete a file in the workspace.",
    parameters: obj({ path: str("File path") }, ["path"]),
    roles: ["coder", "debugger"],
    async run({ path }, ctx) {
      await ctx.sandbox.deleteFile(path);
      return `Deleted ${path}`;
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the repo root inside the sandbox (tests, builds, scripts). Returns exit code, stdout and stderr. Do not push to git.",
    parameters: obj({ command: str("Shell command"), timeout_seconds: { type: "integer" } }, ["command"]),
    roles: ["coder", "qa", "debugger"],
    async run({ command, timeout_seconds }, ctx) {
      const blocked = checkCommand(command);
      if (blocked) throw new Error(blocked);
      const r = await ctx.sandbox.exec(command, {
        timeoutMs: Math.min((timeout_seconds ?? ctx.commandTimeoutMs / 1000) * 1000, 20 * 60_000),
      });
      return truncate(
        `exit_code: ${r.code}${r.timedOut ? " (timed out)" : ""}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`
      );
    },
  },
  {
    name: "view_diff",
    description: "Show the git diff of all changes made so far in this attempt, against the base commit.",
    parameters: obj({}, []),
    roles: ["qa", "debugger"],
    async run(_args, ctx) {
      return (await ctx.getDiff()) || "(no changes)";
    },
  },
  {
    name: "report",
    description:
      "Send a short progress update to the orchestrator (what you found, what you're doing next, or that you're blocked). Use it at milestones, not every step.",
    parameters: obj(
      { status: { type: "string", enum: ["progress", "blocked"] }, message: str("One or two sentences") },
      ["status", "message"]
    ),
    roles: ["coder", "qa", "debugger"],
    async run({ status, message }, ctx) {
      ctx.report(status, message);
      return "Reported to orchestrator.";
    },
  },
  {
    name: "finish",
    description: "Call when the task is complete. Summarize what you changed and how you verified it.",
    parameters: obj({ summary: str("What changed and how it was verified") }, ["summary"]),
    roles: ["coder"],
    terminal: true,
    async run(args, ctx) {
      ctx.result = { tool: "finish", args };
      return "Done.";
    },
  },
  {
    name: "submit_verdict",
    description:
      "QA only. Submit your verdict on the change. pass=true only if it fully solves the task, tests pass, and you found no real problems.",
    parameters: obj(
      {
        pass: { type: "boolean" },
        score: { type: "integer", minimum: 0, maximum: 10, description: "Overall quality 0-10" },
        tests_passed: { type: ["boolean", "null"], description: "null if the repo has no tests" },
        problems: { type: "array", items: { type: "string" }, description: "Concrete problems, empty if none" },
        summary: str("Two or three sentences for the PR description"),
      },
      ["pass", "score", "tests_passed", "problems", "summary"]
    ),
    roles: ["qa"],
    terminal: true,
    async run(args, ctx) {
      ctx.result = { tool: "submit_verdict", args };
      return "Verdict recorded.";
    },
  },
  {
    name: "submit_diagnosis",
    description:
      "Debugger only. Submit the root cause you found and what you changed to fix it (fixed=false if you could not fix it).",
    parameters: obj({ root_cause: str("The underlying cause"), fix: str("What you changed"), fixed: { type: "boolean" } }, [
      "root_cause",
      "fix",
      "fixed",
    ]),
    roles: ["debugger"],
    terminal: true,
    async run(args, ctx) {
      ctx.result = { tool: "submit_diagnosis", args };
      return "Diagnosis recorded.";
    },
  },
];

export function toolsFor(role: Role): ToolDef[] {
  return TOOLS.filter((t) => t.roles.includes(role));
}

export function specsFor(role: Role): ToolSpec[] {
  return toolsFor(role).map(({ name, description, parameters }) => ({ name, description, parameters }));
}

export async function runTool(
  name: string,
  args: any,
  ctx: ToolContext
): Promise<{ output: string; error: boolean; terminal: boolean }> {
  const tool = toolsFor(ctx.role).find((t) => t.name === name);
  if (!tool) return { output: `Unknown tool for role ${ctx.role}: ${name}`, error: true, terminal: false };
  try {
    const output = await tool.run(args ?? {}, ctx);
    return { output, error: false, terminal: !!tool.terminal };
  } catch (e: any) {
    return { output: `Error: ${e?.message ?? e}`, error: true, terminal: false };
  }
}
