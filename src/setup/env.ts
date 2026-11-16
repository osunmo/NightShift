// Detect how to set up and test a repo, and cache installed dependencies keyed by lockfile hash
// so repeat runs (and parallel attempts) skip the install.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Sandbox } from "../sandbox/sandbox.ts";
import { runProcess } from "../sandbox/local.ts";
import type { Store } from "../store/db.ts";

export interface RepoConfig {
  setup: string | null; // install command
  test: string | null; // test command
  cachePaths: string[]; // directories to snapshot after setup, e.g. node_modules
  lockfiles: string[]; // files whose content keys the cache
  source: "config" | "detected" | "none";
}

/** Read .nightshift.json if present, otherwise detect from common files. */
export async function detectConfig(dir: string): Promise<RepoConfig> {
  const cfgFile = join(dir, ".nightshift.json");
  if (existsSync(cfgFile)) {
    const c = JSON.parse(await readFile(cfgFile, "utf8"));
    return {
      setup: c.setup ?? null,
      test: c.test ?? null,
      cachePaths: c.cachePaths ?? [],
      lockfiles: c.lockfiles ?? [".nightshift.json"],
      source: "config",
    };
  }
  const has = (f: string) => existsSync(join(dir, f));
  if (has("package.json")) {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    const hasTest = pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test);
    let setup = "npm install --no-audit --no-fund";
    let lock = ["package.json"];
    if (has("pnpm-lock.yaml")) (setup = "corepack enable && pnpm install --frozen-lockfile"), (lock = ["pnpm-lock.yaml"]);
    else if (has("yarn.lock")) (setup = "corepack enable && yarn install --frozen-lockfile"), (lock = ["yarn.lock"]);
    else if (has("package-lock.json")) (setup = "npm ci --no-audit --no-fund"), (lock = ["package-lock.json"]);
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).length;
    return {
      setup: deps ? setup : null,
      test: hasTest ? "npm test" : null,
      cachePaths: deps ? ["node_modules"] : [],
      lockfiles: lock,
      source: "detected",
    };
  }
  if (has("requirements.txt") || has("pyproject.toml")) {
    const req = has("requirements.txt") ? await readFile(join(dir, "requirements.txt"), "utf8") : "";
    const hasDeps = req.trim().length > 0 || has("pyproject.toml");
    const setup = hasDeps
      ? `python3 -m venv .venv && .venv/bin/pip install -q ${has("requirements.txt") ? "-r requirements.txt" : "-e ."}`
      : null;
    const py = hasDeps ? ".venv/bin/python" : "python3";
    const usesPytest = /pytest/.test(req) || has("pytest.ini") || has("conftest.py");
    return {
      setup,
      test: usesPytest ? `${py} -m pytest -q` : `${py} -m unittest discover -q`,
      cachePaths: hasDeps ? [".venv"] : [],
      lockfiles: [has("requirements.txt") ? "requirements.txt" : "pyproject.toml"],
      source: "detected",
    };
  }
  if (has("tests") || has("test")) {
    const { readdir } = await import("node:fs/promises");
    const dirFiles = [...(has("tests") ? await readdir(join(dir, "tests")) : []), ...(has("test") ? await readdir(join(dir, "test")) : [])];
    if (dirFiles.some((f) => /^test.*\.py$/.test(f)))
      return { setup: null, test: "python3 -m unittest discover -q", cachePaths: [], lockfiles: [], source: "detected" };
  }
  return { setup: null, test: null, cachePaths: [], lockfiles: [], source: "none" };
}

export async function cacheKey(dir: string, cfg: RepoConfig, sandboxKind: string): Promise<string | null> {
  if (!cfg.setup || !cfg.cachePaths.length) return null;
  const h = createHash("sha256").update(sandboxKind).update("\0").update(cfg.setup);
  for (const f of cfg.lockfiles) {
    const p = join(dir, f);
    h.update("\0" + f + "\0");
    if (existsSync(p)) h.update(await readFile(p));
  }
  return h.digest("hex").slice(0, 16);
}

export interface SetupResult {
  ms: number;
  cached: boolean;
  ran: boolean;
  key: string | null;
  output?: string;
}

/**
 * Prepare dependencies in the sandbox's workspace.
 * Cache hit: extract the saved tarball. Miss: run setup, then save cachePaths as a tarball.
 */
export async function prepareEnv(
  sandbox: Sandbox,
  cfg: RepoConfig,
  store: Store,
  cacheDir: string,
  opts: { save?: boolean } = { save: true }
): Promise<SetupResult> {
  const t0 = Date.now();
  if (!cfg.setup) return { ms: Date.now() - t0, cached: false, ran: false, key: null };
  const key = await cacheKey(sandbox.workdir, cfg, sandbox.kind);
  const snap = key ? store.getSnapshot(key) : null;
  if (key && snap && existsSync(snap.path)) {
    const r = await runProcess("tar", ["-xzf", snap.path, "-C", sandbox.workdir], {}, 10 * 60_000);
    if (r.code === 0) {
      store.hitSnapshot(key);
      return { ms: Date.now() - t0, cached: true, ran: false, key };
    }
  }
  const r = await sandbox.exec(cfg.setup, { timeoutMs: 20 * 60_000 });
  if (r.code !== 0) throw new Error(`Setup failed (${cfg.setup}):\n${r.stderr || r.stdout}`);
  if (key && opts.save !== false) {
    const present = [];
    for (const p of cfg.cachePaths) if (existsSync(join(sandbox.workdir, p))) present.push(p);
    if (present.length) {
      await mkdir(cacheDir, { recursive: true });
      const file = join(cacheDir, `${key}.tgz`);
      const t = await runProcess("tar", ["-czf", file, "-C", sandbox.workdir, ...present], {}, 10 * 60_000);
      if (t.code === 0) store.putSnapshot(key, file, (await stat(file)).size);
    }
  }
  return { ms: Date.now() - t0, cached: false, ran: true, key, output: (r.stdout + r.stderr).slice(-2000) };
}
