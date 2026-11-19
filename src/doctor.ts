// `nightshift doctor`: start a real sandbox, prove it works, and report how isolated it is.
//
// Checks: the sandbox starts; the workspace mount works both ways (host writes, sandbox reads and
// writes back); commands run; timeouts are enforced inside the sandbox; and, for Kubernetes, the
// RuntimeClass exists. Compares the sandbox's kernel with the host's: a different kernel means the
// attempt runs in its own VM (Kata/QEMU or gVisor), not just a container.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { createSandbox, type SandboxMode } from "./sandbox/index.ts";
import { kubernetesConfigFromEnv } from "./sandbox/kubernetes.ts";
import { dockerConfigFromEnv } from "./sandbox/docker.ts";
import { runProcess } from "./sandbox/local.ts";

type Check = { name: string; ok: boolean; detail: string };

export async function doctor(mode: SandboxMode, log: (s: string) => void = console.log): Promise<{ ok: boolean; checks: Check[]; isolated: "vm" | "container" | "none" }> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") => {
    checks.push({ name, ok, detail });
    log(`${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
  };
  log(`Sandbox: ${mode}`);

  if (mode === "kubernetes") {
    const k = kubernetesConfigFromEnv();
    const [bin, ...pre] = k.kubectl;
    const kc = (args: string[]) => runProcess(bin, [...pre, ...args], {}, 30_000);
    const v = await kc(["version", "-o", "json"]);
    let server = "";
    try {
      server = JSON.parse(v.stdout).serverVersion?.gitVersion ?? "";
    } catch {}
    add("kubectl reaches the cluster", v.code === 0 && !!server, server || (v.stderr || v.stdout).trim().split("\n")[0]);
    if (!server) return finish("none");
    const ns = await kc(["get", "namespace", k.namespace]);
    add(`namespace "${k.namespace}" exists`, ns.code === 0, ns.code === 0 ? "" : `create it: kubectl apply -f deploy/kubernetes/namespace.yaml`);
    if (k.runtimeClass) {
      const rc = await kc(["get", "runtimeclass", k.runtimeClass, "-o", "jsonpath={.handler}"]);
      add(`RuntimeClass "${k.runtimeClass}" exists`, rc.code === 0, rc.code === 0 ? `handler ${rc.stdout}` : "install Kata: deploy/vm/setup.sh");
    } else {
      add("RuntimeClass", true, "none set: pods use the default container runtime (set NIGHTSHIFT_K8S_RUNTIME_CLASS=kata for microVMs)");
    }
    if (ns.code !== 0) return finish("none");
  }
  if (mode === "docker") {
    const d = dockerConfigFromEnv();
    const [bin, ...pre] = d.dockerBin;
    const v = await runProcess(bin, [...pre, "version", "--format", "{{.Server.Version}}"], {}, 30_000);
    add("docker daemon reachable", v.code === 0, v.code === 0 ? `server ${v.stdout.trim()}` : (v.stderr || v.stdout).trim().split("\n")[0]);
    if (v.code !== 0) return finish("none");
    if (d.runtime) add("runtime", true, d.runtime);
  }

  const dir = await mkdtemp(join(tmpdir(), "nightshift-doctor-"));
  const sb = createSandbox(mode, dir, `doctor-${Date.now().toString(36)}`);
  let isolated: "vm" | "container" | "none" = mode === "local" ? "none" : "container";
  try {
    const t0 = Date.now();
    await sb.start();
    add("sandbox starts", true, `${((Date.now() - t0) / 1000).toFixed(1)}s`);

    await writeFile(join(dir, "from-host.txt"), "hello from the host\n");
    const r = await sb.exec("cat from-host.txt && echo 'hello from the sandbox' > from-sandbox.txt && id -u");
    add("sandbox reads the workspace", r.code === 0 && r.stdout.includes("hello from the host"), r.code === 0 ? "" : (r.stderr || r.stdout).trim());
    const back = await readFile(join(dir, "from-sandbox.txt"), "utf8").catch(() => "");
    add("host sees files the sandbox writes", back.includes("hello from the sandbox"), back ? `written as uid ${r.stdout.trim().split("\n").pop()}` : "");

    const k = await sb.exec("uname -r");
    const kernel = k.stdout.trim();
    if (mode !== "local") {
      // Same kernel version as the host means a shared kernel. Kata/QEMU and gVisor present their own.
      const hostKernel = mode === "kubernetes" ? await nodeKernel() : release();
      const own = !!kernel && !!hostKernel && kernel !== hostKernel;
      if (own) isolated = "vm";
      add("isolation", true, own ? `own kernel ${kernel} (host ${hostKernel}): VM-level isolation` : `shared host kernel ${kernel}: container isolation only`);
    }

    const t1 = Date.now();
    const to = await sb.exec("sleep 30", { timeoutMs: 2000 });
    const secs = (Date.now() - t1) / 1000;
    add("timeouts stop commands", to.timedOut && secs < 25, `stopped after ${secs.toFixed(1)}s`);
  } catch (e) {
    add("sandbox starts", false, (e as Error).message);
  } finally {
    await sb.dispose().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return finish(isolated);

  function finish(iso: "vm" | "container" | "none") {
    const ok = checks.every((c) => c.ok);
    log(ok ? `\nAll checks passed. Isolation: ${iso === "vm" ? "microVM (own kernel)" : iso === "container" ? "container (shared kernel)" : "none (local)"}.` : "\nSome checks failed.");
    return { ok, checks, isolated: iso };
  }
}

/** Kernel of a node in the cluster, for comparison with the pod's kernel. */
async function nodeKernel() {
  const k = kubernetesConfigFromEnv();
  const [bin, ...pre] = k.kubectl;
  const r = await runProcess(bin, [...pre, "get", "nodes", "-o", "jsonpath={.items[0].status.nodeInfo.kernelVersion}"], {}, 20_000);
  return r.code === 0 ? r.stdout.trim() : "";
}
