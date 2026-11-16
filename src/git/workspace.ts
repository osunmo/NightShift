// Git workspace management: one base clone per task, one git worktree (and branch) per attempt.
import { mkdir, readFile, rm, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runProcess } from "../sandbox/local.ts";

export async function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  const r = await runProcess("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, timeoutMs);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

export interface BaseWorkspace {
  dir: string;
  baseSha: string;
}

/** Clone the repo (URL or local path) at baseBranch into <taskDir>/base. */
export async function cloneBase(repo: string, baseBranch: string, taskDir: string, token?: string): Promise<BaseWorkspace> {
  const dir = join(taskDir, "base");
  await rm(dir, { recursive: true, force: true });
  await mkdir(taskDir, { recursive: true });
  const src = isLocalPath(repo) ? resolve(repo) : withToken(repo, token);
  await git(taskDir, ["clone", "--quiet", "--branch", baseBranch, src, dir], 10 * 60_000);
  await git(dir, ["config", "user.name", "Nightshift"]);
  await git(dir, ["config", "user.email", "nightshift@users.noreply.github.com"]);
  const baseSha = (await git(dir, ["rev-parse", "HEAD"])).trim();
  return { dir, baseSha };
}

/** Make a worktree on a fresh branch for one attempt. */
export async function addWorktree(base: BaseWorkspace, path: string, branch: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await git(base.dir, ["worktree", "add", "--quiet", "-b", branch, path, base.baseSha]);
}

export async function removeWorktree(base: BaseWorkspace, path: string): Promise<void> {
  try {
    await git(base.dir, ["worktree", "remove", "--force", path]);
  } catch {
    await rm(path, { recursive: true, force: true });
  }
}

/** Exclude paths (dependency caches) from git without touching the repo's .gitignore. */
export async function excludePaths(base: BaseWorkspace, paths: string[]) {
  if (!paths.length) return;
  const f = join(base.dir, ".git", "info", "exclude");
  const cur = existsSync(f) ? await readFile(f, "utf8") : "";
  const add = paths.filter((p) => !cur.split("\n").includes(`/${p}`)).map((p) => `/${p}`);
  if (add.length) await appendFile(f, "\n" + add.join("\n") + "\n");
}

/** Diff of everything in the worktree (tracked + untracked) against the base commit. */
export async function diffAgainstBase(worktree: string, baseSha: string): Promise<string> {
  await git(worktree, ["add", "-A"]);
  return git(worktree, ["diff", "--cached", "--no-color", baseSha]);
}

export async function diffStat(worktree: string, baseSha: string): Promise<{ files: number; added: number; removed: number }> {
  await git(worktree, ["add", "-A"]);
  const out = await git(worktree, ["diff", "--cached", "--numstat", baseSha]);
  let added = 0,
    removed = 0,
    files = 0;
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const [a, r] = line.split("\t");
    files++;
    added += Number(a) || 0;
    removed += Number(r) || 0;
  }
  return { files, added, removed };
}

export async function commitAll(worktree: string, message: string): Promise<string | null> {
  await git(worktree, ["add", "-A"]);
  const status = await git(worktree, ["status", "--porcelain"]);
  if (!status.trim()) return null;
  await git(worktree, ["commit", "-q", "-m", message]);
  return (await git(worktree, ["rev-parse", "HEAD"])).trim();
}

export function isLocalPath(repo: string) {
  return !/^(https?:\/\/|git@|ssh:\/\/)/.test(repo);
}

export function withToken(url: string, token?: string) {
  if (!token || !url.startsWith("https://github.com/")) return url;
  return url.replace("https://", `https://x-access-token:${token}@`);
}

/** owner/repo from a GitHub URL, or null. */
export function parseGitHub(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
