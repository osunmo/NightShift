// Runs only when NIGHTSHIFT_TEST_DOCKER=1 (needs a working Docker daemon and the NIGHTSHIFT_DOCKER_* env).
import test from "node:test";
import assert from "node:assert/strict";
import { DockerSandbox, dockerConfigFromEnv } from "../src/sandbox/docker.ts";
import { tmp } from "./helpers.ts";

test("docker sandbox: commands run inside the container against the mounted workspace", { skip: process.env.NIGHTSHIFT_TEST_DOCKER !== "1" }, async () => {
  const dir = await tmp();
  const sb = new DockerSandbox(dir, dockerConfigFromEnv(), `nightshift-test-${Date.now()}`);
  await sb.start();
  try {
    await sb.writeFile("hello.txt", "from host\n");
    const r = await sb.exec("cat hello.txt && hostname && pwd && echo made-in-container > out.txt");
    assert.equal(r.code, 0, r.stderr);
    const [content, hostname, cwd] = r.stdout.trim().split("\n");
    assert.equal(content, "from host");
    assert.equal(cwd, "/workspace");
    assert.ok(sb.containerId!.startsWith(hostname), "hostname is the container id");
    assert.equal((await sb.readFile("out.txt")).trim(), "made-in-container");
    const t = await sb.exec("sleep 10", { timeoutMs: 1000 });
    assert.equal(t.timedOut, true);
  } finally {
    await sb.dispose();
  }
});

test("docker sandbox replaces a container that disappears, and the workspace survives", { skip: !process.env.NIGHTSHIFT_TEST_DOCKER }, async () => {
  const { DockerSandbox, dockerConfigFromEnv } = await import("../src/sandbox/docker.ts");
  const { runProcess } = await import("../src/sandbox/local.ts");
  const { tmp } = await import("./helpers.ts");
  const cfg = dockerConfigFromEnv();
  const sb = new DockerSandbox(await tmp(), cfg, `nightshift-heal-${Date.now().toString(36)}`);
  const reasons: string[] = [];
  sb.onRestart = (r) => reasons.push(r);
  await sb.start();
  try {
    assert.equal((await sb.exec("echo kept > note.txt")).code, 0);
    const [bin, ...pre] = cfg.dockerBin;
    await runProcess(bin, [...pre, "rm", "-f", sb.name], {}, 30_000); // the container vanishes mid-task
    const r = await sb.exec("cat note.txt");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "kept");
    assert.equal(sb.restarts, 1);
    assert.equal(reasons.length, 1);
    const fail = await sb.exec("exit 4");
    assert.equal(fail.code, 4, "an ordinary failing command is not mistaken for a lost container");
    assert.equal(sb.restarts, 1);
  } finally {
    await sb.dispose();
  }
});
