#!/usr/bin/env bash
# Nightshift on a cloud VM: k3s + Kata Containers (QEMU microVMs) + Nightshift as a service.
#
# Target: Ubuntu 24.04 on a VM size with nested virtualization, so /dev/kvm exists:
#   Azure:  Standard_D2s_v5 (or any Dv5/Dsv5/Dasv5; not B-series)        see deploy/vm/AZURE.md
#   Oracle: VM.Standard.E5.Flex or VM.Standard3.Flex (not Ampere/ARM)     see deploy/vm/ORACLE.md
# Without /dev/kvm, run with SKIP_KATA=1 to get Kubernetes pods without microVMs.
#
# Run from the repository root, as the user that will run Nightshift (not root):
#   ./deploy/vm/setup.sh
#
# Environment overrides:
#   SKIP_KATA=1                 no Kata: pods use the default runtime (container isolation)
#   KATA_CHART_VERSION=4.2.0    kata-deploy Helm chart version
#   SANDBOX_IMAGE=node:22-bookworm
#   NIGHTSHIFT_ENV=/etc/nightshift.env
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive # never stop at a package's interactive prompt

KATA_CHART_VERSION="${KATA_CHART_VERSION:-4.2.0}"
SANDBOX_IMAGE="${SANDBOX_IMAGE:-node:22-bookworm}"
NIGHTSHIFT_ENV="${NIGHTSHIFT_ENV:-/etc/nightshift.env}"
SKIP_KATA="${SKIP_KATA:-0}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_USER="$(id -un)"
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "run this as your normal user (it uses sudo where needed), not as root"
[ -f "$REPO_DIR/package.json" ] || die "run from inside the nightshift repository"

# --- 1. preflight -------------------------------------------------------------------------------
say "Preflight"
ARCH="$(uname -m)"
echo "arch: $ARCH, kernel: $(uname -r)"
if [ "$SKIP_KATA" != "1" ]; then
  if [ ! -e /dev/kvm ]; then
    sudo modprobe kvm_amd 2>/dev/null || sudo modprobe kvm_intel 2>/dev/null || true
  fi
  if [ ! -e /dev/kvm ]; then
    die "/dev/kvm is missing, so Kata microVMs cannot run on this VM.
  Use a size with nested virtualization (Azure: Standard_D2s_v5 with security type Standard;
  Oracle: VM.Standard.E5.Flex or VM.Standard3.Flex), or rerun with SKIP_KATA=1 to use Kubernetes without microVMs."
  fi
  echo "/dev/kvm present: microVMs supported"
fi

# --- 2. packages and Node.js ---------------------------------------------------------------------
say "Packages"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates python3 python3-venv build-essential unzip
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "node $(node -v)"

# --- 3. Some images (Oracle's Ubuntu) reject forwarded traffic by default; let the pod network through ---
if sudo iptables -S INPUT 2>/dev/null | grep -q -- "-j REJECT"; then
  say "Firewall rules for the cluster network"
  sudo apt-get install -y iptables-persistent
  for chain in INPUT FORWARD; do
    for cidr in 10.42.0.0/16 10.43.0.0/16; do
      sudo iptables -C "$chain" -s "$cidr" -j ACCEPT 2>/dev/null || sudo iptables -I "$chain" 1 -s "$cidr" -j ACCEPT
      sudo iptables -C "$chain" -d "$cidr" -j ACCEPT 2>/dev/null || sudo iptables -I "$chain" 1 -d "$cidr" -j ACCEPT
    done
  done
  sudo netfilter-persistent save >/dev/null
fi

# --- 4. k3s ------------------------------------------------------------------------------------
say "k3s"
if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644" sh -
fi
for _ in $(seq 1 60); do
  kubectl get nodes 2>/dev/null | grep -q " Ready" && break
  sleep 5
done
kubectl get nodes

# --- 5. Kata Containers -------------------------------------------------------------------------
RUNTIME_CLASS=""
if [ "$SKIP_KATA" != "1" ]; then
  say "Kata Containers (kata-deploy $KATA_CHART_VERSION)"
  if ! command -v helm >/dev/null; then
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  fi
  helm upgrade --install kata-deploy oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy \
    --version "$KATA_CHART_VERSION" --namespace kata-system --create-namespace \
    --set k8sDistribution=k3s --set runtimeClasses.createDefault=true \
    --wait --timeout 15m
  for _ in $(seq 1 60); do
    kubectl get runtimeclass kata >/dev/null 2>&1 && break
    sleep 5
  done
  kubectl get runtimeclass kata >/dev/null 2>&1 || die "the 'kata' RuntimeClass did not appear; check: kubectl -n kata-system logs -l name=kata-deploy"
  kubectl get runtimeclass
  RUNTIME_CLASS="kata"
fi

# --- 6. namespace, network policy, sandbox image ----------------------------------------------
say "Sandbox namespace and image"
kubectl apply -f "$REPO_DIR/deploy/kubernetes/namespace.yaml"
sudo k3s ctr images pull "docker.io/library/$SANDBOX_IMAGE" >/dev/null && echo "pulled $SANDBOX_IMAGE"

# --- 7. Nightshift ------------------------------------------------------------------------------
say "Nightshift"
cd "$REPO_DIR"
npm ci
npm run build:web
if [ ! -f "$NIGHTSHIFT_ENV" ]; then
  sudo tee "$NIGHTSHIFT_ENV" >/dev/null <<EOF
# Nightshift service configuration. Add one model API key, then: sudo systemctl restart nightshift
ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# OPENROUTER_API_KEY=
# GITHUB_TOKEN=

NIGHTSHIFT_SANDBOX=kubernetes
NIGHTSHIFT_K8S_RUNTIME_CLASS=$RUNTIME_CLASS
NIGHTSHIFT_K8S_IMAGE=$SANDBOX_IMAGE
NIGHTSHIFT_K8S_CPU=2
NIGHTSHIFT_K8S_MEMORY=4Gi
KUBECONFIG=/etc/rancher/k3s/k3s.yaml
NIGHTSHIFT_HOME=$HOME/.nightshift
# Loopback only: reach the app through an SSH tunnel.
NIGHTSHIFT_HOST=127.0.0.1
NIGHTSHIFT_PORT=4100
EOF
  sudo chmod 600 "$NIGHTSHIFT_ENV"
  sudo chown "$RUN_USER" "$NIGHTSHIFT_ENV"
  echo "wrote $NIGHTSHIFT_ENV"
fi
sed -e "s|@USER@|$RUN_USER|g" -e "s|@DIR@|$REPO_DIR|g" -e "s|@ENV@|$NIGHTSHIFT_ENV|g" \
  "$REPO_DIR/deploy/vm/nightshift.service" | sudo tee /etc/systemd/system/nightshift.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now nightshift
sleep 3
systemctl --no-pager --lines=5 status nightshift || true

# --- 8. verify ----------------------------------------------------------------------------------
say "Doctor"
set -a
# shellcheck disable=SC1090
. "$NIGHTSHIFT_ENV"
set +a
node --no-warnings --import tsx src/cli.ts doctor --sandbox kubernetes

say "Done"
cat <<EOF
1. Add a model API key:   sudo nano $NIGHTSHIFT_ENV   then   sudo systemctl restart nightshift
2. From your computer:    ssh -L 4100:localhost:4100 $RUN_USER@<vm-public-ip>
3. Open:                  http://localhost:4100/app/
Logs: journalctl -u nightshift -f
EOF
