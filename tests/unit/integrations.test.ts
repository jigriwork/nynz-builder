import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubClient, appJwt, importable, prepareExport, signState, verifyState } from "../../lib/integrations/github";
import { checkTables, isPrivilegedKey, normalizeProjectUrl, tablesInSql, validateConnection } from "../../lib/integrations/customer-supabase";

function mockFetch(routes: Record<string, (body: any) => { status?: number; json?: unknown }>) {
  const calls: Array<{ method: string; path: string; body: any }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    const result = key ? routes[key](body) : { status: 404 };
    return new Response(result.json === undefined ? null : JSON.stringify(result.json), { status: result.status || 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("GitHub App", () => {
  it("signs app JWTs with RS256 and binds install state to the user", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = appJwt("12345", privateKey.export({ type: "pkcs1", format: "pem" }).toString(), 1_800_000_000);
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({ iat: 1_799_999_940, exp: 1_800_000_540, iss: "12345" });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, s, "base64url")).toBe(true);
    const state = signState("user-1", "x".repeat(40), 0);
    expect(verifyState(state, "x".repeat(40), 1000)).toBe("user-1");
    expect(verifyState(state, "y".repeat(40), 1000)).toBeNull();
    expect(verifyState(state, "x".repeat(40), 20 * 60_000)).toBeNull();
  });

  it("excludes environment files and refuses secrets", () => {
    const { included, refused } = prepareExport([
      { path: "src/App.tsx", content: "ok" }, { path: ".env.local", content: "A=1" },
      { path: "src/config.ts", content: 'const k = "sb_secret_abcdefghijklmnop";' }, // nynz-secret-scan: allow (fake test value)
      { path: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nabc" }, // nynz-secret-scan: allow (fake test value)
    ]);
    expect(included.map((f) => f.path)).toEqual(["src/App.tsx"]);
    expect(refused.map((r) => r.path)).toEqual([".env.local", "src/config.ts", "key.pem"]);
    expect(importable("src/App.tsx", 100)).toBe(true);
    expect(importable(".env", 10)).toBe(false);
    expect(importable("node_modules/x/index.js", 10)).toBe(false);
    expect(importable("image.png", 10)).toBe(false);
  });

  it("detects remote changes and deletes only files NYNZ exported before", async () => {
    const { fetcher, calls } = mockFetch({
      "GET /repos/o/r/git/ref/heads/main": () => ({ json: { object: { sha: "remote-head" } } }),
      "GET /repos/o/r/git/commits/remote-head": () => ({ json: { tree: { sha: "base-tree" } } }),
      "POST /repos/o/r/git/trees": () => ({ json: { sha: "new-tree" } }),
      "POST /repos/o/r/git/commits": () => ({ json: { sha: "new-commit" } }),
      "PATCH /repos/o/r/git/refs/heads/main": () => ({ json: {} }),
    });
    const client = new GitHubClient("t", fetcher);
    await expect(client.exportFiles({ repo: "o/r", branch: "main", files: [], expectedHead: "last-synced", previouslyExported: [], message: "m" })).rejects.toThrow("CONFLICT");
    const result = await client.exportFiles({ repo: "o/r", branch: "main", files: [{ path: "a.ts", content: "1" }], expectedHead: "remote-head", previouslyExported: ["a.ts", "old.ts"], message: "m" });
    expect(result.commit).toBe("new-commit");
    const tree = calls.find((c) => c.path === "/repos/o/r/git/trees")!.body;
    expect(tree.base_tree).toBe("base-tree");
    expect(tree.tree).toEqual([{ path: "a.ts", mode: "100644", type: "blob", content: "1" }, { path: "old.ts", mode: "100644", type: "blob", sha: null }]);
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ sha: "new-commit", force: false });
  });
});

describe("customer-owned Supabase", () => {
  it("accepts only browser-safe keys and real project URLs", () => {
    const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
    expect(isPrivilegedKey(serviceJwt)).toBe(true);
    expect(isPrivilegedKey("sb_secret_abc")).toBe(true);
    expect(isPrivilegedKey("sb_publishable_abc")).toBe(false);
    expect(normalizeProjectUrl("https://abcdefghijklmnopqrst.supabase.co/rest")).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(() => normalizeProjectUrl("https://evil.example.com")).toThrow();
  });
  it("validates the key against the project and checks reviewed tables", async () => {
    const ok = mockFetch({ "GET /auth/v1/settings": () => ({ json: { external: { email: true }, disable_signup: false } }), "GET /rest/v1/notes": () => ({ json: [] }), "GET /rest/v1/missing": () => ({ status: 404, json: {} }) });
    expect(await validateConnection("https://p.supabase.co", "k", ok.fetcher)).toEqual({ ok: true, details: { email_auth: true, signup_disabled: false, mailer_autoconfirm: false } });
    const bad = mockFetch({ "GET /auth/v1/settings": () => ({ status: 401, json: {} }) });
    expect((await validateConnection("https://p.supabase.co", "k", bad.fetcher)).ok).toBe(false);
    expect(await checkTables("https://p.supabase.co", "k", ["notes", "missing", "bad name"], ok.fetcher)).toEqual([{ table: "notes", status: "present", http: 200 }, { table: "missing", status: "missing", http: 404 }, { table: "bad name", status: "error", http: 0 }]);
    expect(tablesInSql("create table if not exists public.notes(id int); CREATE TABLE \"Tasks\"(x int);")).toEqual(["notes", "tasks"]);
  });
});
