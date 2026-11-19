// Kubernetes sandbox: one pod per attempt, commands run with `kubectl exec`.
//
// The attempt's worktree stays the source of truth on the Nightshift host, exactly as with Docker:
// the pod mounts it at /workspace, so file tools, the dependency cache, diffs and the PR all keep
// working on the host copy. Two ways to provide that mount:
//   hostPath (default)  Nightshift runs on the node (single-node k3s); the pod mounts the worktree path.
//   pvc:<claim>         Nightshift's home lives on a ReadWriteMany volume; the pod mounts the claim
//                       with subPath = the worktree's path relative to NIGHTSHIFT_HOME.
//
// Isolation: set NIGHTSHIFT_K8S_RUNTIME_CLASS=kata to run every attempt in a Kata Containers microVM
// (QEMU), with its own guest kernel. See deploy/vm/.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { Sandbox, type ExecOptions, type ExecResult } from "./sandbox.ts";
import { runProcess } from "./local.ts";

export interface KubernetesConfig {
  kubectl: string[]; // e.g. ["kubectl"] or ["sudo", "k3s", "kubectl"]
  namespace: string;
  image: string;
  runtimeClass?: string; // e.g. "kata" (Kata Containers, QEMU microVM)
  cpu: string; // limit, e.g. "2"
  memory: string; // limit, e.g. "4Gi"
  network: "bridge" | "none"; // "none" is enforced by the NetworkPolicy in deploy/kubernetes/
  volume: { type: "hostPath" } | { type: "pvc"; claim: string };
  home: string; // NIGHTSHIFT_HOME, for pvc subPaths
  user?: { uid: number; gid: number };
  env: Record<string, string>;
  startTimeoutSec: number;
  maxLifetimeSec: number; // activeDeadlineSeconds: orphaned pods are removed by Kubernetes
  nodeSelector: Record<string, string>;
}

const parseMap = (s: string | undefined) =>
  Object.fromEntries(
    (s || "")
      .split(",")
      .map((kv) => kv.trim())
      .filter(Boolean)
      .map((kv) => kv.split("=") as [string, string])
  );

export function kubernetesConfigFromEnv(env = process.env): KubernetesConfig {
  const vol = env.NIGHTSHIFT_K8S_VOLUME || "hostPath";
  const extraEnv: Record<string, string> = {};
  if (env.NIGHTSHIFT_K8S_PATH) extraEnv.PATH = env.NIGHTSHIFT_K8S_PATH;
  const uid = env.NIGHTSHIFT_K8S_USER;
  return {
    kubectl: (env.NIGHTSHIFT_KUBECTL || "kubectl").split(/\s+/),
    namespace: env.NIGHTSHIFT_K8S_NAMESPACE || "nightshift",
    image: env.NIGHTSHIFT_K8S_IMAGE || env.NIGHTSHIFT_DOCKER_IMAGE || "node:22-bookworm",
    runtimeClass: env.NIGHTSHIFT_K8S_RUNTIME_CLASS || undefined,
    cpu: env.NIGHTSHIFT_K8S_CPU || "2",
    memory: env.NIGHTSHIFT_K8S_MEMORY || "4Gi",
    network: env.NIGHTSHIFT_K8S_NETWORK === "none" ? "none" : "bridge",
    volume: vol.startsWith("pvc:") ? { type: "pvc", claim: vol.slice(4) } : { type: "hostPath" },
    home: resolve(env.NIGHTSHIFT_HOME || join(homedir(), ".nightshift")),
    user: uid ? { uid: Number(uid.split(":")[0]), gid: Number(uid.split(":")[1] ?? uid.split(":")[0]) } : process.getuid ? { uid: process.getuid(), gid: process.getgid!() } : undefined,
    env: extraEnv,
    startTimeoutSec: Number(env.NIGHTSHIFT_K8S_START_TIMEOUT || 300),
    maxLifetimeSec: Number(env.NIGHTSHIFT_K8S_MAX_LIFETIME || 6 * 3600),
    nodeSelector: parseMap(env.NIGHTSHIFT_K8S_NODE_SELECTOR),
  };
}

/** DNS-1123 label: lowercase alphanumerics and '-', at most 63 chars. */
export function podName(name: string) {
  const n = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (n.startsWith("nightshift-") ? n : `nightshift-${n}`).slice(0, 63).replace(/-+$/, "");
}

export function podManifest(cfg: KubernetesConfig, name: string, workdir: string) {
  const volume =
    cfg.volume.type === "hostPath"
      ? { name: "workspace", hostPath: { path: workdir, type: "Directory" } }
      : { name: "workspace", persistentVolumeClaim: { claimName: cfg.volume.claim } };
  let subPath: string | undefined;
  if (cfg.volume.type === "pvc") {
    const rel = relative(cfg.home, workdir);
    if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error(`Workspace ${workdir} is not under NIGHTSHIFT_HOME (${cfg.home}); pvc mode needs it there.`);
    subPath = rel.split(sep).join("/");
  }
  const env = { CI: "1", HOME: "/tmp", PYTHONDONTWRITEBYTECODE: "1", ...cfg.env };
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace: cfg.namespace,
      labels: {
        "app.kubernetes.io/name": "nightshift-sandbox",
        "app.kubernetes.io/managed-by": "nightshift",
        "nightshift.dev/network": cfg.network,
      },
    },
    spec: {
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      terminationGracePeriodSeconds: 0,
      activeDeadlineSeconds: cfg.maxLifetimeSec,
      ...(cfg.runtimeClass ? { runtimeClassName: cfg.runtimeClass } : {}),
      ...(Object.keys(cfg.nodeSelector).length ? { nodeSelector: cfg.nodeSelector } : {}),
      securityContext: {
        ...(cfg.user ? { runAsUser: cfg.user.uid, runAsGroup: cfg.user.gid, runAsNonRoot: cfg.user.uid !== 0 } : {}),
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "sandbox",
          image: cfg.image,
          command: ["sleep", "infinity"],
          workingDir: "/workspace",
          env: Object.entries(env).map(([name, value]) => ({ name, value })),
          resources: {
            requests: { cpu: "250m", memory: "512Mi" },
            limits: { cpu: cfg.cpu, memory: cfg.memory },
          },
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
          volumeMounts: [{ name: "workspace", mountPath: "/workspace", ...(subPath ? { subPath } : {}) }],
        },
      ],
      volumes: [volume],
    },
  };
}

export class KubernetesSandbox extends Sandbox {
  kind = "kubernetes" as const;
  readonly pod: string;
  private started = false;

  constructor(workdir: string, private cfg: KubernetesConfig, name: string) {
    super(workdir);
    this.pod = podName(name);
  }

  private kubectl(args: string[], timeoutMs?: number) {
    const [bin, ...pre] = this.cfg.kubectl;
    return runProcess(bin, [...pre, "-n", this.cfg.namespace, ...args], {}, timeoutMs);
  }

  async start() {
    // A pod left over from a crashed run would block the name.
    await this.kubectl(["delete", "pod", this.pod, "--ignore-not-found", "--grace-period=0", "--wait=true"], 60_000);
    const dir = await mkdtemp(join(tmpdir(), "nightshift-pod-"));
    const file = join(dir, "pod.json");
    try {
      await writeFile(file, JSON.stringify(podManifest(this.cfg, this.pod, this.workdir), null, 2));
      const c = await this.kubectl(["create", "-f", file], 60_000);
      if (c.code !== 0) throw new Error(`kubectl create failed: ${(c.stderr || c.stdout).trim()}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const w = await this.kubectl(["wait", "--for=condition=Ready", `pod/${this.pod}`, `--timeout=${this.cfg.startTimeoutSec}s`], (this.cfg.startTimeoutSec + 30) * 1000);
    if (w.code !== 0) {
      const why = await this.describeFailure();
      await this.dispose();
      throw new Error(`Sandbox pod ${this.pod} did not become ready: ${why || (w.stderr || w.stdout).trim()}`);
    }
    this.started = true;
  }

  /** The most useful reason a pod failed to start: a waiting reason, or the latest warning event. */
  private async describeFailure() {
    const s = await this.kubectl(["get", "pod", this.pod, "-o", "jsonpath={.status.phase} {.status.containerStatuses[0].state.waiting.reason} {.status.containerStatuses[0].state.waiting.message}"], 20_000);
    const e = await this.kubectl(["get", "events", "--field-selector", `involvedObject.name=${this.pod},type=Warning`, "-o", "jsonpath={range .items[*]}{.reason}: {.message}{\"\\n\"}{end}"], 20_000);
    return [s.stdout.trim(), e.stdout.trim().split("\n").pop()].filter(Boolean).join(" | ");
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (!this.started) throw new Error("sandbox not started");
    const envArgs = Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${v}`);
    // Enforce the timeout inside the pod too: killing the kubectl client alone would leave the
    // command running in the container.
    const secs = Math.max(1, Math.ceil((opts.timeoutMs ?? 10 * 60_000) / 1000));
    const remote = ["env", ...envArgs, "timeout", "-k", "5", String(secs), "bash", "-lc", cmd];
    return this.execRecovering(
      async () => {
        const r = await this.kubectl(["exec", this.pod, "-c", "sandbox", "--", ...remote], (secs + 20) * 1000);
        // kubectl adds its own line for non-zero exits; the command's output is what matters.
        const stderr = r.stderr.replace(/^command terminated with exit code \d+\s*$/m, "").trimEnd();
        return { ...r, stderr, timedOut: r.timedOut || r.code === 124 };
      },
      async () => (await this.kubectl(["get", "pod", this.pod, "-o", "jsonpath={.status.phase}"], 20_000)).stdout.trim() === "Running",
      (r) => /Error from server|NotFound|container not found|unable to upgrade connection|does not exist/i.test(r.stderr)
    );
  }

  async dispose() {
    this.started = false;
    await this.kubectl(["delete", "pod", this.pod, "--ignore-not-found", "--grace-period=0", "--wait=false"], 30_000);
  }
}
