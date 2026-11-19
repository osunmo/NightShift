#!/usr/bin/env node
// A stand-in for kubectl that runs pods as Docker containers, for testing the Kubernetes sandbox
// without a cluster. Implements only what KubernetesSandbox and `nightshift doctor` call:
//   version, get namespace|runtimeclass|nodes|pod|events, create -f, wait, exec, delete pod.
// It honours the parts of the pod spec that matter here: image, command, workingDir, env,
// runAsUser/runAsGroup, cpu/memory limits, hostPath volume, and runtimeClassName (mapped to a Docker
// runtime through FAKEKUBE_RUNTIMES, e.g. "kata=runc"). Every created manifest is saved to
// $FAKEKUBE_DIR so tests can assert on it.
//   FAKEKUBE_DOCKER   docker command, e.g. "sudo docker" (default "docker")
//   FAKEKUBE_MOUNTS   extra "host:container:ro" mounts, comma separated (for images without a userland)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { release } from "node:os";

const docker = (process.env.FAKEKUBE_DOCKER || "docker").split(/\s+/);
const dir = process.env.FAKEKUBE_DIR || "/tmp/fakekube";
mkdirSync(dir, { recursive: true });
const runtimes = Object.fromEntries((process.env.FAKEKUBE_RUNTIMES || "").split(",").filter(Boolean).map((kv) => kv.split("=")));

const d = (args, opts = {}) => spawnSync(docker[0], [...docker.slice(1), ...args], { encoding: "utf8", ...opts });
const out = (s) => process.stdout.write(s);

let argv = process.argv.slice(2);
// global flags
for (let i = 0; i < argv.length; i++) if (argv[i] === "-n" || argv[i] === "--namespace") argv.splice(i--, 2);
const [verb, ...rest] = argv;

switch (verb) {
  case "version":
    out(JSON.stringify({ clientVersion: { gitVersion: "v1.31.0" }, serverVersion: { gitVersion: "v1.31.0-fakekube" } }));
    break;
  case "get": {
    const [what, name] = rest;
    if (what === "namespace") process.exit(0);
    if (what === "runtimeclass") {
      if (name in runtimes) out(runtimes[name]);
      else (process.stderr.write(`Error from server (NotFound): runtimeclasses.node.k8s.io "${name}" not found\n`), process.exit(1));
      break;
    }
    if (what === "nodes") out(release());
    if (what === "pod") out(d(["inspect", "-f", "{{.State.Status}}", name]).stdout.trim() === "running" ? "Running" : "Pending");
    break;
  }
  case "create": {
    const file = rest[rest.indexOf("-f") + 1];
    const pod = JSON.parse(readFileSync(file, "utf8"));
    const name = pod.metadata.name;
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(pod, null, 2));
    const c = pod.spec.containers[0];
    const args = ["run", "-d", "--name", name, "-w", c.workingDir];
    const sc = pod.spec.securityContext || {};
    if (sc.runAsUser != null) args.push("--user", `${sc.runAsUser}:${sc.runAsGroup ?? sc.runAsUser}`);
    if (c.resources?.limits?.memory) args.push("--memory", c.resources.limits.memory.replace(/Gi$/, "g").replace(/Mi$/, "m"));
    if (c.resources?.limits?.cpu) args.push("--cpus", c.resources.limits.cpu);
    if (c.securityContext?.capabilities?.drop?.includes("ALL")) args.push("--cap-drop", "ALL");
    if (c.securityContext?.allowPrivilegeEscalation === false) args.push("--security-opt", "no-new-privileges");
    if (pod.metadata.labels?.["nightshift.dev/network"] === "none") args.push("--network", "none");
    if (pod.spec.runtimeClassName) {
      const rt = runtimes[pod.spec.runtimeClassName];
      if (!rt) (process.stderr.write(`pods "${name}" is forbidden: RuntimeClass "${pod.spec.runtimeClassName}" not found\n`), process.exit(1));
      args.push("--runtime", rt);
    }
    for (const e of c.env || []) args.push("-e", `${e.name}=${e.value}`);
    const vols = Object.fromEntries((pod.spec.volumes || []).map((v) => [v.name, v]));
    for (const m of c.volumeMounts || []) {
      const v = vols[m.name];
      if (!v?.hostPath) (process.stderr.write("fakekube supports hostPath volumes only\n"), process.exit(1));
      args.push("-v", `${v.hostPath.path}:${m.mountPath}`);
    }
    for (const m of (process.env.FAKEKUBE_MOUNTS || "").split(",").filter(Boolean)) args.push("-v", m);
    args.push(c.image, ...c.command);
    const r = d(args);
    if (r.status !== 0) (process.stderr.write(r.stderr), process.exit(1));
    out(`pod/${name} created\n`);
    break;
  }
  case "wait": {
    const name = rest.find((a) => a.startsWith("pod/")).slice(4);
    for (let i = 0; i < 50; i++) {
      if (d(["inspect", "-f", "{{.State.Running}}", name]).stdout.trim() === "true") (out(`pod/${name} condition met\n`), process.exit(0));
      spawnSync("sleep", ["0.2"]);
    }
    process.stderr.write(`error: timed out waiting for the condition on pods/${name}\n`);
    process.exit(1);
  }
  case "exec": {
    const name = rest[0];
    if (d(["inspect", "-f", "{{.State.Running}}", name]).stdout.trim() !== "true") {
      process.stderr.write(`Error from server (NotFound): pods "${name}" not found\n`); // what real kubectl prints
      process.exit(1);
    }
    const cmd = rest.slice(rest.indexOf("--") + 1);
    const r = spawnSync(docker[0], [...docker.slice(1), "exec", name, ...cmd], { stdio: "inherit" });
    const code = r.status ?? 1;
    if (code !== 0) process.stderr.write(`command terminated with exit code ${code}\n`);
    process.exit(code);
  }
  case "delete": {
    const name = rest[1];
    d(["rm", "-f", name]);
    out(`pod "${name}" deleted\n`);
    break;
  }
  default:
    process.stderr.write(`fakekube: unsupported command ${verb}\n`);
    process.exit(1);
}
