import { useEffect, useState, type FormEvent } from "react";
import { Box, Eye, EyeOff, GitPullRequest, Settings2, SquareArrowOutUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { api, type GitHubAppInfo, type Info } from "@/lib/api";
import { readPreferences, savePreferences, wordCount } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const sections = [
  { id: "github", label: "GitHub", icon: GitPullRequest },
  { id: "models", label: "Models", icon: Box },
  { id: "preferences", label: "Preferences", icon: Settings2 },
] as const;

const providers = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

function Status({ configured }: { configured?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
      <span className={cn("size-1.5 rounded-full bg-muted-foreground", configured && "bg-success")} />
      {configured === undefined ? "Unknown" : configured ? "Configured" : "Not configured"}
    </span>
  );
}

function GitHubAppPanel() {
  const [data, setData] = useState<GitHubAppInfo>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<number>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.githubApp(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      setError("");
    }).catch((failure: Error) => {
      if (controller.signal.aborted) return;
      setData(undefined);
      setError(failure.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [refresh]);

  function reload() {
    setLoading(true);
    setRefresh((count) => count + 1);
  }

  async function connect(id: number) {
    setConnecting(id);
    setError("");
    try {
      await api.connectGitHubApp(id);
      reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not connect to GitHub.");
    } finally {
      setConnecting(undefined);
    }
  }

  return (
    <div className="mb-5 divide-y rounded-xl border" aria-busy={loading || connecting !== undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 className="text-sm font-medium">GitHub App</h3>
          {data?.configured && data.connection && <p className="mt-1 text-xs text-muted-foreground">Connected to {data.connection.account}</p>}
          {data?.configured && data.connection && <p className="mt-1 text-xs text-muted-foreground">{data.connection.canPublish ? "App permissions allow cloning and opening pull requests." : "Grant Contents and Pull requests read/write permissions on GitHub to enable publishing."}</p>}
          {data?.configured === false && <p className="mt-1 text-xs text-muted-foreground">Configure a private GitHub App on the Nightshift server to get started.</p>}
          {loading && <p role="status" className="mt-1 text-xs text-muted-foreground">Loading GitHub access…</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.configured && (
            <a href={data.connection?.manageUrl ?? data.installUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4">
              {data.connection ? "Manage on GitHub" : "Install on GitHub"} <SquareArrowOutUpRight className="size-3.5" />
            </a>
          )}
          {data?.configured !== false && <Button variant="outline" size="sm" disabled={loading || connecting !== undefined} onClick={reload}>Refresh</Button>}
        </div>
      </div>
      {error && <p role="alert" className="p-4 text-sm text-danger">{error}</p>}
      {data?.configured && !loading && (
        <>
          {data.installations.some(({ id }) => data.connection?.id !== id) && (
            <div className="grid gap-2 p-4">
              <h4 className="text-sm font-medium">{data.connection ? "Other installations" : "Choose an installation"}</h4>
              {data.installations.filter(({ id }) => data.connection?.id !== id).map(({ id, account }) => (
                <div key={id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{account}</span>
                  <Button size="sm" variant="outline" disabled={connecting !== undefined} onClick={() => connect(id)}>
                    {connecting === id ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {!data.installations.length && <p className="p-4 text-sm text-muted-foreground">Install the app on GitHub, choose repositories, then refresh here.</p>}
          {data.connection && (
            <div className="p-4">
              <h4 className="mb-2 text-sm font-medium">Repositories <span className="text-muted-foreground">({data.repositories.length})</span></h4>
              {data.repositories.length === 0 ? (
                <p className="text-sm text-muted-foreground">This installation has no repositories available.</p>
              ) : (
                <ul className="max-h-80 divide-y overflow-y-auto">
                  {data.repositories.map((repo) => (
                    <li key={repo.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                      <a href={repo.url} target="_blank" rel="noreferrer" className="min-w-0 break-all underline underline-offset-4">{repo.name}</a>
                      <span className="text-xs text-muted-foreground">{repo.private ? "Private" : "Public"} · {repo.defaultBranch}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModelKeyForm({ provider, configured, onInfoChanged }: {
  provider: (typeof providers)[number];
  configured?: boolean;
  onInfoChanged: (info: Info) => void;
}) {
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    setFeedback("");
    try {
      onInfoChanged(await api.saveModelKey(provider.id, key.trim()));
      setKey("");
      setVisible(false);
      setFeedback("Key saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save the key.");
    } finally {
      setBusy(false);
    }
  }

  const inputId = `model-key-${provider.id}`;
  const VisibilityIcon = visible ? EyeOff : Eye;
  return (
    <form onSubmit={save} className="grid gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">{provider.label} API key</label>
        <Status configured={configured} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={inputId} type={visible ? "text" : "password"} value={key}
          placeholder={configured ? "Enter a replacement key" : "Enter API key"}
          onChange={(event) => { setKey(event.target.value); setFeedback(""); }}
          autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={4096} disabled={busy}
          className="min-w-36 flex-1 font-mono" />
        <Button type="button" variant="outline" size="icon"
          aria-label={`${visible ? "Hide" : "Show"} ${provider.label} key entry`}
          aria-pressed={visible} onClick={() => setVisible(!visible)}>
          <VisibilityIcon />
        </Button>
        <Button type="submit" size="sm" disabled={!key.trim() || busy}>
          {busy ? "Saving…" : configured ? "Update key" : "Add key"}
        </Button>
      </div>
      {feedback && <p role="status" className="text-xs text-muted-foreground">{feedback}</p>}
    </form>
  );
}

function PreferencesForm() {
  const [saved, setSaved] = useState(readPreferences);
  const [draft, setDraft] = useState(saved);
  const [feedback, setFeedback] = useState("");
  const words = wordCount(draft.rules);
  const changed = saved.rules !== draft.rules || saved.autoDraft !== draft.autoDraft;

  return (
    <form className="divide-y rounded-xl border" onSubmit={(event) => {
      event.preventDefault();
      if (words > 100 || !changed) return;
      try {
        savePreferences(draft);
        setSaved(draft);
        setFeedback("Preferences saved.");
      } catch {
        setFeedback("This browser could not save your preferences.");
      }
    }}>
      <label className="flex cursor-pointer items-center justify-between gap-4 p-4">
        <span>
          <span className="block text-sm font-medium">Automatically create draft pull requests</span>
          <span className="mt-1 block text-xs text-muted-foreground">For completed GitHub tasks when publishing is enabled on the server.</span>
        </span>
        <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={draft.autoDraft} onChange={(event) => {
          setDraft({ ...draft, autoDraft: event.target.checked });
          setFeedback("");
        }} />
      </label>
      <div className="grid gap-2 p-4">
        <label htmlFor="agent-rules" className="text-sm font-medium">Agent rules</label>
        <Textarea id="agent-rules" value={draft.rules} rows={5} aria-describedby="rules-count" aria-invalid={words > 100} onChange={(event) => {
          setDraft({ ...draft, rules: event.target.value });
          setFeedback("");
        }} />
        <p id="rules-count" className={cn("text-xs text-muted-foreground", words > 100 && "text-danger")}>{words} / 100 words</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 p-4">
        <span role="status" className="mr-auto text-xs text-muted-foreground">{feedback}</span>
        <Button size="sm" type="submit" disabled={!changed || words > 100}>Save preferences</Button>
      </div>
    </form>
  );
}

export function SettingsPage({ section, info, onInfoChanged }: { section?: string; info: Info | null; onInfoChanged: (info: Info) => void }) {
  const active = sections.find((item) => item.id === section) ?? sections[0];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-5xl px-5 py-8 md:px-10 md:py-12">
        <header className="mb-7 border-b pb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </header>
        <div className="grid gap-7 md:grid-cols-[10rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="flex flex-wrap gap-1 self-start md:flex-col">
            {sections.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#/settings/${id}`} aria-current={active.id === id ? "page" : undefined}
                className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground", active.id === id && "bg-accent font-medium text-foreground")}>
                <Icon className="size-4" />{label}
              </a>
            ))}
          </nav>
          <section aria-labelledby="settings-section" className="min-w-0">
            <h2 id="settings-section" className="text-lg font-semibold">{active.label}</h2>
            {active.id === "github" && (
              <>
                <p className="mb-4 mt-1 text-sm text-muted-foreground">Manage repository access and pull request publishing.</p>
                <GitHubAppPanel />
                <div className="divide-y rounded-xl border">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <h3 className="text-sm font-medium">Fallback GitHub token</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Set <code>NIGHTSHIFT_GITHUB_TOKEN</code> or <code>GITHUB_TOKEN</code> on the server and restart Nightshift.</p>
                    </div>
                    <Status configured={info?.githubConfigured} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <h3 className="text-sm font-medium">Pull request publishing</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{!info ? "Server status unavailable." : info.prs === "github-app" ? "Uses the connected GitHub App for repositories it can access." : info.prs === "github" ? "Enabled on the server." : "Server is in dry-run mode."}</p>
                    </div>
                    <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4">
                      Manage tokens <SquareArrowOutUpRight className="size-3.5" />
                    </a>
                  </div>
                </div>
              </>
            )}
            {active.id === "models" && (
              <>
                <p className="mb-4 mt-1 text-sm text-muted-foreground">
                  Keys are saved on the Nightshift server and apply without a restart. {info?.demo
                    ? "Demo mode uses the scripted provider."
                    : info?.provider === "unconfigured" ? "No active provider." : info && `Active provider: ${info.provider}.`}
                </p>
                <div className="divide-y rounded-xl border">
                  {providers.map((provider) => (
                    <ModelKeyForm key={provider.id} provider={provider} configured={info?.modelKeys?.[provider.id]} onInfoChanged={onInfoChanged} />
                  ))}
                </div>
              </>
            )}
            {active.id === "preferences" && (
              <>
                <p className="mb-4 mt-1 text-sm text-muted-foreground">These settings apply to new tasks started from this browser. Agent rules become part of the task description.</p>
                <PreferencesForm />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
