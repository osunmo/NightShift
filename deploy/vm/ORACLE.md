# Nightshift on Oracle Cloud: Kubernetes + Kata microVMs

This sets up one Oracle Cloud VM that runs Nightshift, a single-node k3s cluster, and Kata Containers.
Every attempt then runs in its own pod, and every pod is a QEMU microVM with its own Linux kernel,
so code an agent runs cannot reach the host kernel the way it could from a plain container.

```
your computer ──ssh tunnel──▶ VM: Nightshift (127.0.0.1:4100)
                                 │ kubectl
                                 ▼
                              k3s ── pod per attempt ── Kata runtime ── QEMU microVM (own kernel)
                                         │
                                         └─ /workspace = the attempt's worktree on the VM (hostPath)
```

## 1. Create the VM

In the Oracle Cloud console: **Compute → Instances → Create instance**.

| Setting | Value |
|---|---|
| Image | Canonical Ubuntu 24.04 |
| Shape | **VM.Standard.E5.Flex** (AMD) or **VM.Standard3.Flex** (Intel), 2 OCPUs, 16 GB memory or more |
| Boot volume | 100 GB |
| Networking | public subnet, assign a public IPv4 address |
| SSH keys | upload your public key |

Kata needs `/dev/kvm`, which these shapes provide through nested virtualization. **Ampere (ARM) shapes,
including the always-free A1, do not**; on those, run the setup with `SKIP_KATA=1` and you get
Kubernetes pods with container isolation instead.

Leave the subnet's security list allowing only SSH (port 22). You reach the app through an SSH
tunnel, so nothing else needs to be open.

## 2. Copy Nightshift to the VM

From PowerShell on your computer (OpenSSH is built into Windows):

```powershell
scp nightshift.zip ubuntu@<vm-public-ip>:
ssh ubuntu@<vm-public-ip>
```

On the VM:

```bash
sudo apt-get install -y unzip && unzip nightshift.zip && cd nightshift
```

## 3. Run the setup

```bash
./deploy/vm/setup.sh
```

It takes 10 to 20 minutes and is safe to rerun. It:

1. checks for `/dev/kvm` and stops with an explanation if the shape can't run microVMs;
2. installs Node 22, git, Python and build tools;
3. opens Oracle's default Ubuntu firewall to the cluster's pod and service networks;
4. installs k3s;
5. installs Kata Containers with the official `kata-deploy` Helm chart, which creates the `kata` RuntimeClass;
6. creates the `nightshift` namespace and its network policies (no inbound traffic; outbound only to
   the public internet, never to the cloud metadata service or private networks);
7. installs Nightshift as a systemd service configured for `NIGHTSHIFT_SANDBOX=kubernetes` with Kata;
8. runs `nightshift doctor`, which starts a real sandbox pod and checks it.

The doctor's last lines should say:

```
✓ isolation  own kernel 6.x.y (host 6.8.0-...): VM-level isolation
All checks passed. Isolation: microVM (own kernel).
```

## 4. Add a model key and open the app

```bash
sudo nano /etc/nightshift.env      # set ANTHROPIC_API_KEY (or OPENAI_API_KEY / OPENROUTER_API_KEY)
sudo systemctl restart nightshift
```

From your computer:

```powershell
ssh -L 4100:localhost:4100 ubuntu@<vm-public-ip>
```

Open http://localhost:4100/app/. The sidebar shows `sandbox: kubernetes · kata`. While a task runs,
`kubectl -n nightshift get pods` on the VM shows one pod per attempt.

## Checks and tests

```bash
cd ~/nightshift
set -a; . /etc/nightshift.env; set +a
npm run cli -- doctor                                                     # sandbox health
NIGHTSHIFT_TEST_K8S=1 node --import tsx --test test/kubernetes.test.ts    # real-cluster test
npm run eval -- --attempts 2 --modes review --only py-retry,js-dates      # real tasks, hidden tests
```

## Settings

All in `/etc/nightshift.env`:

| Variable | Default | |
|---|---|---|
| `NIGHTSHIFT_K8S_RUNTIME_CLASS` | `kata` | empty for the default runtime (containers) |
| `NIGHTSHIFT_K8S_IMAGE` | `node:22-bookworm` | must have bash and GNU coreutils |
| `NIGHTSHIFT_K8S_CPU` / `_MEMORY` | `2` / `4Gi` | per attempt |
| `NIGHTSHIFT_K8S_NETWORK` | `bridge` | `none` cuts all network access |
| `NIGHTSHIFT_K8S_NAMESPACE` | `nightshift` | |
| `NIGHTSHIFT_K8S_VOLUME` | `hostPath` | `pvc:<claim>` when NIGHTSHIFT_HOME is on a ReadWriteMany volume (multi-node) |
| `NIGHTSHIFT_MAX_TASKS` | `2` | tasks at once; each runs one pod per attempt |

## Troubleshooting

- **`/dev/kvm is missing`**: the shape has no nested virtualization. Recreate on E5.Flex or Standard3.Flex, or use `SKIP_KATA=1`.
- **Pod stuck in ContainerCreating**: `kubectl -n nightshift describe pod <name>`. The first start pulls the sandbox image (about 1 GB).
- **Kata not installing**: `kubectl -n kata-system logs -l name=kata-deploy`.
- **Leftover pods**: they expire on their own after 6 hours; to clear now, `kubectl -n nightshift delete pods -l app.kubernetes.io/managed-by=nightshift`.
- **Cost**: Flex shapes bill while running. Stop the instance in the console when you're not using it.
