import { createHmac, createSign, timingSafeEqual } from "node:crypto";

/**
 * GitHub App integration (https://docs.github.com/en/apps). NYNZ acts with a
 * short-lived installation token scoped to the repositories the customer chose
 * when installing the app ("Contents: read and write" only). Nothing is
 * simulated: without GITHUB_APP_ID, GITHUB_APP_SLUG and GITHUB_APP_PRIVATE_KEY
 * the feature reports "not configured".
 */
export function githubConfig(env: Record<string, string | undefined> = process.env) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_SLUG || !env.GITHUB_APP_PRIVATE_KEY) return null;
  return { appId: env.GITHUB_APP_ID, slug: env.GITHUB_APP_SLUG, privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"), stateSecret: env.GITHUB_STATE_SECRET || env.PREVIEW_SIGNING_SECRET || "" };
}

export function appJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)) {
  const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: now - 60, exp: now + 540, iss: appId })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
}

/** Signed, expiring state binds the installation callback to the NYNZ user who started it. */
export function signState(userId: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: now + 15 * 60_000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`gh-state.${payload}`).digest("base64url")}`;
}
export function verifyState(state: string, secret: string, now = Date.now()) {
  const [payload, sig] = String(state).split(".");
  if (!payload || !sig || !secret) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(`gh-state.${payload}`).digest("base64url"));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try { const data = JSON.parse(Buffer.from(payload, "base64url").toString()); return data.e > now ? String(data.u) : null; } catch { return null; }
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/], ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ["service-role JWT", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/], ["Stripe/Razorpay live secret", /\b(?:sk_live_|rzp_live_)[A-Za-z0-9]{10,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/], ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/], ["OpenAI/OpenRouter key", /\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{20,}/],
];
const EXCLUDE = (path: string) => /(^|\/)\.env(\.|$)/.test(path) || path.startsWith(".git/") || path.includes("node_modules/") || path === ".nynz-preview.mjs";

/** Files safe to export, and any that were refused because they look like secrets. */
export function prepareExport(files: Array<{ path: string; content: string }>) {
  const refused: Array<{ path: string; reason: string }> = [];
  const included = files.filter((file) => {
    if (EXCLUDE(file.path)) { refused.push({ path: file.path, reason: "environment or internal file" }); return false; }
    const hit = SECRET_PATTERNS.find(([, pattern]) => pattern.test(file.content));
    if (hit) { refused.push({ path: file.path, reason: `contains what looks like a ${hit[0]}` }); return false; }
    return true;
  });
  return { included, refused };
}

const IMPORT_TEXT = /\.(tsx?|jsx?|mjs|cjs|css|scss|html|json|md|txt|svg|ya?ml|toml|sql|env\.example|gitignore|npmrc)$|(^|\/)(Dockerfile|LICENSE|README)$/i;
export function importable(path: string, size: number) {
  return !EXCLUDE(path) && size <= 500_000 && IMPORT_TEXT.test(path) && /^[A-Za-z0-9._@/+-]+$/.test(path) && !path.split("/").some((p) => p === ".." || p === "");
}

export class GitHubClient {
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch) {}
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`https://api.github.com${path}`, { method, signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "NYNZ" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 404 || response.status === 409) throw Object.assign(new Error(`GITHUB_${response.status}`), { status: response.status });
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]} failed (${response.status})`);
    return (response.status === 204 ? null : await response.json()) as T;
  }
  static async forInstallation(appId: string, privateKey: string, installationId: number, fetcher: typeof fetch = fetch) {
    const response = await fetcher(`https://api.github.com/app/installations/${installationId}/access_tokens`, { method: "POST", headers: { authorization: `Bearer ${appJwt(appId, privateKey)}`, accept: "application/vnd.github+json", "user-agent": "NYNZ" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`GitHub installation token failed (${response.status})`);
    return new GitHubClient((await response.json()).token, fetcher);
  }

  /**
   * Commits NYNZ's files on top of the branch head. Fails with CONFLICT when
   * the branch moved since the last sync (unless the caller passes the head
   * they reviewed). Files NYNZ exported previously but no longer has are
   * deleted; other repository files (for example CI configuration) are kept.
   */
  async exportFiles(input: { repo: string; branch: string; files: Array<{ path: string; content: string }>; expectedHead: string | null; previouslyExported: string[]; message: string }) {
    let head: string | null = null;
    try { head = (await this.call<{ object: { sha: string } }>("GET", `/repos/${input.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`)).object.sha; }
    catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
    if (input.expectedHead && head && head !== input.expectedHead) throw Object.assign(new Error("CONFLICT"), { head });
    const baseTree = head ? (await this.call<{ tree: { sha: string } }>("GET", `/repos/${input.repo}/git/commits/${head}`)).tree.sha : undefined;
    const current = new Set(input.files.map((f) => f.path));
    const tree = [
      ...input.files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })),
      ...input.previouslyExported.filter((path) => !current.has(path)).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
    ];
    const newTree = await this.call<{ sha: string }>("POST", `/repos/${input.repo}/git/trees`, { ...(baseTree ? { base_tree: baseTree } : {}), tree });
    const commit = await this.call<{ sha: string }>("POST", `/repos/${input.repo}/git/commits`, { message: input.message, tree: newTree.sha, parents: head ? [head] : [] });
    if (head) await this.call("PATCH", `/repos/${input.repo}/git/refs/heads/${encodeURIComponent(input.branch)}`, { sha: commit.sha, force: false });
    else await this.call("POST", `/repos/${input.repo}/git/refs`, { ref: `refs/heads/${input.branch}`, sha: commit.sha });
    return { commit: commit.sha };
  }

  async importFiles(input: { repo: string; branch: string; maxFiles: number }) {
    const ref = await this.call<{ object: { sha: string } }>("GET", `/repos/${input.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`);
    const commit = await this.call<{ tree: { sha: string } }>("GET", `/repos/${input.repo}/git/commits/${ref.object.sha}`);
    const tree = await this.call<{ tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated: boolean }>("GET", `/repos/${input.repo}/git/trees/${commit.tree.sha}?recursive=1`);
    const wanted = tree.tree.filter((entry) => entry.type === "blob" && importable(entry.path, entry.size || 0));
    if (wanted.length > input.maxFiles) throw new Error(`Repository has more than ${input.maxFiles} importable files`);
    const files: Array<{ path: string; content: string }> = [];
    for (const entry of wanted) {
      const blob = await this.call<{ content: string; encoding: string }>("GET", `/repos/${input.repo}/git/blobs/${entry.sha}`);
      const content = Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8").toString("utf8");
      if (!content.includes("\u0000")) files.push({ path: entry.path, content });
    }
    return { head: ref.object.sha, files, skipped: tree.tree.filter((e) => e.type === "blob").length - files.length, truncated: tree.truncated };
  }
}
