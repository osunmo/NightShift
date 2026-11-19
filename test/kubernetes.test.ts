import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { KubernetesSandbox, kubernetesConfigFromEnv, podManifest, podName } from "../src/sandbox/kubernetes.ts";
import { parseSandboxMode } from "../src/sandbox/index.ts";
import { doctor } from "../src/doctor.ts";
import { tmp } from "./helpers.ts";

const base = () => kubernetesConfigFromEnv({ NIGHTSHIFT_HOME: "/srv/ns" } as NodeJS.ProcessEnv);

test("sandbox mode parsing accepts kubernetes and k8s, rejects typos", () => {
  assert.equal(parseSandboxMode(undefined), "local");
  assert.equal(parseSandboxMode("docker"), "docker");
  assert.equal(parseSandboxMode("k8s"), "kubernetes");
  assert.equal(parseSandboxMode("Kubernetes"), "kubernetes");
  assert.throws(() => parseSandboxMode("kubernets"), /Unknown sandbox/);
});

test("pod names are valid DNS labels", () => {
  assert.equal(podName("a_1f2e_1"), "nightshift-a-1f2e-1");
  assert.equal(podName("nightshift-Doctor"), "nightshift-doctor");
  const long = podName("x".repeat(100));
  assert.ok(long.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(long), long);
});

test("pod manifest: hostPath workspace, limits, hardening, no API token", () => {
  const cfg = { ...base(), user: { uid: 1001, gid: 1001 } };
  const m = podManifest(cfg, "nightshift-a-1", "/srv/ns/workspaces/t1/a1");
  assert.equal(m.metadata.namespace, "nightshift");
  assert.equal(m.metadata.labels["app.kubernetes.io/managed-by"], "nightshift");
  assert.equal(m.spec.restartPolicy, "Never");
  assert.equal(m.spec.automountServiceAccountToken, false);
  assert.ok(m.spec.activeDeadlineSeconds > 0, "orphaned pods expire");
  assert.equal("runtimeClassName" in m.spec, false, "default runtime unless configured");
  assert.deepEqual(m.spec.volumes[0], { name: "workspace", hostPath: { path: "/srv/ns/workspaces/t1/a1", type: "Directory" } });
  const c = m.spec.containers[0];
  assert.equal(c.volumeMounts[0].mountPath, "/workspace");
  assert.equal(c.workingDir, "/workspace");
  assert.deepEqual(c.resources.limits, { cpu: "2", memory: "4Gi" });
  assert.equal(c.securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(c.securityContext.capabilities.drop, ["ALL"]);
  assert.equal(m.spec.securityContext.runAsUser, 1001);
  assert.equal(m.spec.securityContext.runAsNonRoot, true);
});

test("pod manifest: Kata runtime class, no-network label, node selector", () => {
  const cfg = kubernetesConfigFromEnv({
    NIGHTSHIFT_HOME: "/srv/ns",
    NIGHTSHIFT_K8S_RUNTIME_CLASS: "kata",
    NIGHTSHIFT_K8S_NETWORK: "none",
    NIGHTSHIFT_K8S_NODE_SELECTOR: "katacontainers.io/kata-runtime=true",
  } as NodeJS.ProcessEnv);
  const m = podManifest(cfg, "p", "/srv/ns/w");
  assert.equal(m.spec.runtimeClassName, "kata");
  assert.equal(m.metadata.labels["nightshift.dev/network"], "none");
  assert.deepEqual(m.spec.nodeSelector, { "katacontainers.io/kata-runtime": "true" });
});

test("pod manifest: shared volume mode mounts the claim at the worktree's subPath", () => {
  const cfg = kubernetesConfigFromEnv({ NIGHTSHIFT_HOME: "/srv/ns", NIGHTSHIFT_K8S_VOLUME: "pvc:nightshift-home" } as NodeJS.ProcessEnv);
  const m = podManifest(cfg, "p", "/srv/ns/workspaces/t1/a1");
  assert.deepEqual(m.spec.volumes[0], { name: "workspace", persistentVolumeClaim: { claimName: "nightshift-home" } });
  assert.equal(m.spec.containers[0].volumeMounts[0].subPath, "workspaces/t1/a1");
  assert.throws(() => podManifest(cfg, "p", "/elsewhere/w"), /not under NIGHTSHIFT_HOME/);
});

// End to end against a stand-in kubectl that runs pods as Docker containers (needs Docker).
const dockerEnv = process.env.NIGHTSHIFT_TEST_DOCKER === "1";
test("kubernetes sandbox: pod lifecycle, workspace mount, exit codes, in-pod timeouts", { skip: !dockerEnv }, async () => {
  const dir = await tmp();
  const env = { ...process.env, NIGHTSHIFT_KUBECTL: `node ${join(import.meta.dirname, "fixtures/fake-kubectl.mjs")}`, FAKEKUBE_DIR: await tmp() };
  Object.assign(process.env, env);
  const sb = new KubernetesSandbox(dir, kubernetesConfigFromEnv(), `test-${Date.now().toString(36)}`);
  await sb.start();
  try {
    await sb.writeFile("hello.txt", "from host\n");
    const r = await sb.exec("cat hello.txt && pwd && echo made-in-pod > out.txt");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split("\n"), ["from host", "/workspace"]);
    assert.equal((await sb.readFile("out.txt")).trim(), "made-in-pod");
    const f = await sb.exec("echo oops >&2; exit 3");
    assert.equal(f.code, 3);
    assert.equal(f.stderr.trim(), "oops", "kubectl's own exit-code line is stripped");
    const e = await sb.exec("echo $GREETING", { env: { GREETING: "hi" } });
    assert.equal(e.stdout.trim(), "hi");
    const t0 = Date.now();
    const t = await sb.exec("sleep 30", { timeoutMs: 1500 });
    assert.equal(t.timedOut, true);
    assert.ok(Date.now() - t0 < 15_000, "timeout enforced inside the pod");
  } finally {
    await sb.dispose();
  }
});

// Real cluster: run on the VM after deploy/vm/setup.sh (see deploy/vm/AZURE.md or ORACLE.md).
test("kubernetes sandbox on a real cluster passes doctor", { skip: process.env.NIGHTSHIFT_TEST_K8S !== "1", timeout: 600_000 }, async () => {
  const r = await doctor("kubernetes", () => {});
  assert.ok(r.ok, r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("\n"));
  if (process.env.NIGHTSHIFT_K8S_RUNTIME_CLASS?.startsWith("kata")) assert.equal(r.isolated, "vm", "Kata pods run their own kernel");
});

test("kubernetes sandbox replaces a pod that disappears, and the workspace survives", { skip: !dockerEnv }, async () => {
  const dir = await tmp();
  Object.assign(process.env, { NIGHTSHIFT_KUBECTL: `node ${join(import.meta.dirname, "fixtures/fake-kubectl.mjs")}`, FAKEKUBE_DIR: await tmp() });
  const sb = new KubernetesSandbox(dir, kubernetesConfigFromEnv(), `heal-${Date.now().toString(36)}`);
  const reasons: string[] = [];
  sb.onRestart = (r) => reasons.push(r);
  await sb.start();
  try {
    assert.equal((await sb.exec("echo kept > note.txt")).code, 0);
    const { runProcess } = await import("../src/sandbox/local.ts");
    const [bin, ...pre] = process.env.NIGHTSHIFT_KUBECTL!.split(" ");
    await runProcess(bin, [...pre, "-n", "nightshift", "delete", "pod", sb.pod], { env: process.env as Record<string, string> }, 30_000); // evicted
    const r = await sb.exec("cat note.txt");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "kept");
    assert.equal(sb.restarts, 1);
    assert.equal(reasons.length, 1);
    const fail = await sb.exec("ls does-not-exist");
    assert.notEqual(fail.code, 0);
    assert.equal(sb.restarts, 1, "a failing command is not mistaken for a lost pod");
  } finally {
    await sb.dispose();
  }
});
