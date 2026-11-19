# Nightshift on Azure: Kubernetes + Kata microVMs

One Azure VM runs Nightshift, a single-node k3s cluster and Kata Containers, so every attempt runs
in its own QEMU microVM with its own kernel. Azure for Students (GitHub Student Developer Pack)
covers it with its credit; no card needed.

You stay signed in to Azure in your own browser. Everything below is copy and paste.

## 1. Make an SSH key (PowerShell, once)

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\nightshift_azure
```

Press Enter twice for no passphrase (or set one). Then print the public key and copy the whole line:

```powershell
Get-Content $HOME\.ssh\nightshift_azure.pub
```

## 2. Create the VM (Azure Cloud Shell)

In the Azure portal, click the Cloud Shell icon (`>_`) in the top bar and choose **Bash**. Paste,
replacing `PASTE_PUBLIC_KEY_HERE` with the line you copied:

```bash
LOC=eastus   # if your student subscription refuses this region, try westus2, centralus or northeurope
az group create -n nightshift-rg -l $LOC
az vm create -g nightshift-rg -n nightshift \
  --image Canonical:ubuntu-24_04-lts:server:latest \
  --size Standard_D2s_v5 \
  --security-type Standard \
  --admin-username azureuser \
  --ssh-key-values "PASTE_PUBLIC_KEY_HERE" \
  --public-ip-sku Standard \
  --nsg-rule SSH \
  --os-disk-size-gb 64 \
  --query publicIpAddress -o tsv
```

The last line it prints is the VM's IP address.

- **Standard_D2s_v5** (2 vCPUs, 8 GiB) supports nested virtualization, which Kata needs. B-series
  sizes do not.
- **`--security-type Standard`** avoids Trusted Launch, so nothing interferes with nested virtualization.
- Only SSH (port 22) is open. The app is reached through an SSH tunnel.

## 3. Copy Nightshift over and run the setup (PowerShell)

From the folder where `nightshift.zip` is (replace `<IP>`):

```powershell
scp -i $HOME\.ssh\nightshift_azure nightshift.zip azureuser@<IP>:
ssh -i $HOME\.ssh\nightshift_azure azureuser@<IP>
```

Now on the VM:

```bash
sudo apt-get update && sudo apt-get install -y unzip
unzip -q nightshift.zip && cd nightshift
./deploy/vm/setup.sh
```

It takes 10 to 20 minutes and is safe to rerun. It ends with `nightshift doctor`, which should say:

```
All checks passed. Isolation: microVM (own kernel).
```

See [the setup steps](ORACLE.md#3-run-the-setup) for what the script does; it is the same on both clouds.

## 4. Add a model key and open the app

On the VM:

```bash
sudo nano /etc/nightshift.env      # set ANTHROPIC_API_KEY (or OPENAI_API_KEY / OPENROUTER_API_KEY)
sudo systemctl restart nightshift
```

From PowerShell, keep this window open while you use the app:

```powershell
ssh -i $HOME\.ssh\nightshift_azure -L 4100:localhost:4100 azureuser@<IP>
```

Open http://localhost:4100/app/. The sidebar shows `sandbox: kubernetes · kata`.

## 5. Stop it when you're not using it

A running VM uses credit every hour. In Cloud Shell:

```bash
az vm deallocate -g nightshift-rg -n nightshift   # stop (compute billing stops; the disk is kept)
az vm start -g nightshift-rg -n nightshift        # start again later
```

The IP address stays the same. Unfinished tasks resume when the VM comes back (see Recovery in the
main README). To delete everything: `az group delete -n nightshift-rg`.

## Troubleshooting

- **Size not available / quota error**: student subscriptions limit regions and vCPUs. Try another
  region (step 2, `LOC=`), or `Standard_D2as_v5` (AMD, also supports nested virtualization).
- **`/dev/kvm is missing`** from the setup: the VM was created with Trusted Launch or a B-series size.
  Recreate it with the command above, or run `SKIP_KATA=1 ./deploy/vm/setup.sh` for container isolation.
- Everything else: see [ORACLE.md troubleshooting](ORACLE.md#troubleshooting); it applies here too.
