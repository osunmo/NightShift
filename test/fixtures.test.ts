// Validates the eval set itself: every planted bug fails its hidden check, every reference fix passes
// both visible and hidden checks. Without this, eval numbers would be meaningless.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES, makeRepo } from "../src/eval/fixtures.ts";
import { detectConfig } from "../src/setup/env.ts";
import { cleanEnv, runProcess } from "../src/sandbox/local.ts";
import { tmp } from "./helpers.ts";

const sh = (cwd: string, cmd: string) => runProcess("bash", ["-lc", cmd], { cwd, env: { ...cleanEnv(), PYTHONDONTWRITEBYTECODE: "1" } }, 60_000);

for (const fx of FIXTURES) {
  test(`fixture ${fx.name}: bug fails hidden check, reference fix passes`, async () => {
    const dir = await tmp(`ns-fx-${fx.name}-`);
    await makeRepo(dir, fx.files);
    const cfg = await detectConfig(dir);
    assert.ok(cfg.test, "test command detected");
    await writeFile(join(dir, fx.hiddenCheck.file), fx.hiddenCheck.content);
    assert.notEqual((await sh(dir, fx.hiddenCheck.command)).code, 0, "buggy code must fail the hidden check");
    for (const [f, c] of Object.entries(fx.solution)) await writeFile(join(dir, f), c);
    const visible = await sh(dir, cfg.test!);
    assert.equal(visible.code, 0, visible.stdout + visible.stderr);
    const hidden = await sh(dir, fx.hiddenCheck.command);
    assert.equal(hidden.code, 0, hidden.stdout + hidden.stderr);
  });
}
