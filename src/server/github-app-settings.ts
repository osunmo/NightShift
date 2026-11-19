import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGitHub } from "../git/workspace.ts";

export type GitHubTokenPurpose = "clone" | "checkpoint" | "pull-request";

type Installation = {
  id: number;
  account: { login: string } | null;
  suspended_at: string | null;
  html_url: string;
  permissions?: { contents?: string; pull_requests?: string };
};

type Repository = { id: number; full_name: string; private: boolean; default_branch: string };

class GitHubRequestError extends Error {
  constructor(public status: number) {
    super("GitHub request failed.");
  }
}

export function createGitHubAppSettings(home: string, env = process.env, request = fetch) {
  const slug = env.NIGHTSHIFT_GITHUB_APP_SLUG;
  const appId = env.NIGHTSHIFT_GITHUB_APP_ID;
  const keyFile = env.NIGHTSHIFT_GITHUB_APP_PRIVATE_KEY_FILE;
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || !appId || !/^\d+$/.test(appId) || !keyFile) return;
  const installUrl = `https://github.com/apps/${slug}/installations/new`;
  const connectionFile = join(home, "github-app-connection.json");

  async function appToken() {
    const key = createPrivateKey(await readFile(keyFile!));
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
    return `${claims}.${sign("RSA-SHA256", Buffer.from(claims), key).toString("base64url")}`;
  }

  async function github(path: string, token: string, payload?: object) {
    const response = await request(`https://api.github.com${path}`, {
      method: payload ? "POST" : "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2026-03-10",
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new GitHubRequestError(response.status);
    return response;
  }

  async function pages<T>(path: string, token: string, items: (payload: any) => T[]) {
    const rows: T[] = [];
    for (let page = 1; ; page++) {
      const response = await github(`${path}?per_page=100&page=${page}`, token);
      rows.push(...items(await response.json()));
      if (!response.headers.get("link")?.includes('rel="next"')) return rows;
    }
  }

  async function connectedId(): Promise<number | undefined> {
    try {
      const connection = JSON.parse(await readFile(connectionFile, "utf8"));
      if (connection.appId === appId && Number.isSafeInteger(connection.installationId) && connection.installationId > 0) {
        return connection.installationId;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  function installationChoice(installation: Installation) {
    return {
      id: installation.id,
      account: installation.account?.login ?? `Installation ${installation.id}`,
      canPublish: installation.permissions?.contents === "write" && installation.permissions?.pull_requests === "write",
      manageUrl: /^https:\/\/github\.com\//.test(installation.html_url) ? installation.html_url : installUrl,
    };
  }

  async function installationToken(id: number, jwt: string, scope: {
    repositories?: string[];
    permissions: Record<string, "read" | "write">;
  }) {
    const response = await github(`/app/installations/${id}/access_tokens`, jwt, scope);
    const { token } = await response.json();
    if (typeof token !== "string" || !token) throw new Error("GitHub returned no installation token.");
    return token;
  }

  async function tokenForRepo(remote: string, purpose: GitHubTokenPurpose) {
    const repo = parseGitHub(remote);
    if (!repo) return;
    const id = await connectedId();
    if (!id) return;
    const jwt = await appToken();
    let installation: Installation;
    try {
      installation = await (await github(`/repos/${repo.owner}/${repo.repo}/installation`, jwt)).json();
    } catch (error) {
      if (error instanceof GitHubRequestError && error.status === 404) return;
      throw error;
    }
    if (installation.id !== id) return;
    if (installation.suspended_at) throw new Error("The connected GitHub App installation is suspended.");

    const permissions: Record<string, "read" | "write"> = { contents: purpose === "clone" ? "read" : "write" };
    if (purpose === "pull-request") permissions.pull_requests = "write";
    try {
      return await installationToken(id, jwt, { repositories: [repo.repo], permissions });
    } catch (error) {
      if (error instanceof GitHubRequestError && [403, 422].includes(error.status)) {
        throw new Error("Check the connected GitHub App's repository access and Contents and Pull requests permissions.");
      }
      throw error;
    }
  }

  async function list() {
    const [token, id] = await Promise.all([appToken(), connectedId()]);
    const installed = await pages<Installation>("/app/installations", token, (payload) => payload);
    const available = installed.filter((installation) => !installation.suspended_at);
    const installations = available.map(installationChoice);
    const connection = installations.find((installation) => installation.id === id);
    if (!connection) return { configured: true, installUrl, installations, repositories: [] };

    const readToken = await installationToken(connection.id, token, { permissions: { metadata: "read" } });
    const repositories = await pages<Repository>("/installation/repositories", readToken, (payload) => payload.repositories);
    return {
      configured: true,
      installUrl,
      installations,
      connection,
      repositories: repositories.map((repo) => ({
        id: repo.id,
        name: repo.full_name,
        url: `https://github.com/${repo.full_name.split("/").map(encodeURIComponent).join("/")}`,
        private: repo.private,
        defaultBranch: repo.default_branch,
      })).sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  return {
    list,
    tokenForRepo,
    async connect(id: number) {
      let installation: Installation;
      try {
        installation = await (await github(`/app/installations/${id}`, await appToken())).json();
      } catch (error) {
        if (error instanceof GitHubRequestError && error.status === 404) return false;
        throw error;
      }
      if (installation.id !== id || installation.suspended_at) return false;

      const temporary = join(home, `.github-app-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ appId, installationId: id }), { flag: "wx", mode: 0o600 });
        await rename(temporary, connectionFile);
      } finally {
        await rm(temporary, { force: true });
      }
      return true;
    },
  };
}

export type GitHubAppSettings = ReturnType<typeof createGitHubAppSettings>;
