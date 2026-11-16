// Push the winning branch and open a pull request through the GitHub REST API.
import { git, parseGitHub, withToken } from "./workspace.ts";

export interface PRRequest {
  repoUrl: string;
  worktree: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  token?: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}

export interface PRResult {
  url: string | null;
  dryRun: boolean;
  title: string;
  body: string;
  reason?: string;
}

export async function openPullRequest(req: PRRequest): Promise<PRResult> {
  const gh = parseGitHub(req.repoUrl);
  if (req.dryRun || !req.token || !gh) {
    const reason = req.dryRun ? "dry run" : !gh ? "repo is not a GitHub URL" : "no GITHUB_TOKEN set";
    return { url: null, dryRun: true, title: req.title, body: req.body, reason };
  }
  await git(req.worktree, ["push", "--quiet", withToken(req.repoUrl, req.token), `${req.branch}:${req.branch}`], 5 * 60_000);
  const f = req.fetchImpl ?? fetch;
  const res = await f(`https://api.github.com/repos/${gh.owner}/${gh.repo}/pulls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${req.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ title: req.title, body: req.body, head: req.branch, base: req.baseBranch, draft: false }),
  });
  if (!res.ok) throw new Error(`GitHub PR creation failed: ${res.status} ${await res.text()}`);
  const json: any = await res.json();
  return { url: json.html_url, dryRun: false, title: req.title, body: req.body };
}
