import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { issuePreviewToken, previewKeys, redactPreviewUrl, safeNextPath, verifyPreviewToken } from "../../lib/preview/token";
import { handlePreview, SESSION_COOKIE } from "../../preview-host/lib/core";

const SECRET = "test-preview-secret-0123456789abcdef0123456789";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
process.env.PREVIEW_SIGNING_SECRET = SECRET;

describe("preview tokens", () => {
  it("is deployed byte-identical to the preview host copy", () => {
    expect(readFileSync("preview-host/lib/token.ts", "utf8")).toBe(readFileSync("lib/preview/token.ts", "utf8"));
  });
  it("requires a dedicated secret distinct from the database key", () => {
    expect(() => previewKeys({})).toThrow(/PREVIEW_SIGNING_SECRET/);
    expect(() => previewKeys({ PREVIEW_SIGNING_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: SECRET })).toThrow(/differ/);
  });
  it("binds type, project and host; rotation accepts the previous key", () => {
    const keys = previewKeys();
    const { token } = issuePreviewToken({ typ: "x", projectId: P1, userId: U1, aud: `${P1}.preview.nynz.in` }, keys);
    expect(verifyPreviewToken(token, { typ: "x", aud: `${P1}.preview.nynz.in` }, keys)).toMatchObject({ ok: true, expired: false });
    expect(verifyPreviewToken(token, { typ: "s", aud: `${P1}.preview.nynz.in` }, keys)).toMatchObject({ ok: false, reason: "type" });
    expect(verifyPreviewToken(token, { typ: "x", aud: `${P2}.preview.nynz.in` }, keys)).toMatchObject({ ok: false, reason: "audience" });
    expect(verifyPreviewToken(`${token.split(".")[0]}.AAAA`, { typ: "x", aud: `${P1}.preview.nynz.in` }, keys)).toMatchObject({ ok: false });
    const rotated = previewKeys({ PREVIEW_SIGNING_SECRET: `${SECRET}-new`, PREVIEW_SIGNING_SECRET_PREVIOUS: SECRET });
    expect(verifyPreviewToken(token, { typ: "x", aud: `${P1}.preview.nynz.in` }, rotated)).toMatchObject({ ok: true });
    const removed = previewKeys({ PREVIEW_SIGNING_SECRET: `${SECRET}-new` });
    expect(verifyPreviewToken(token, { typ: "x", aud: `${P1}.preview.nynz.in` }, removed)).toMatchObject({ ok: false, reason: "signature" });
  });
  it("only accepts relative redirect paths and redacts URL tokens", () => {
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("/dashboard?x=1")).toBe("/dashboard?x=1");
    expect(redactPreviewUrl("https://p.nynz.in/__nynz/exchange?t=abc.def&next=/")).toBe("https://p.nynz.in/__nynz/exchange?t=[redacted]&next=/");
  });
});

describe("preview proxy core", () => {
  const nonces = new Set<string>();
  const owners: Record<string, string> = { [P1]: U1, [P2]: U2 };
  const deps = {
    rpc: async (_fn: string, args: Record<string, unknown>) => ({ data: owners[String(args.p_project)] === args.p_user ? [{ sandbox_id: `sbx-${String(args.p_project).slice(0, 4)}` }] : [], error: null }),
    insertNonce: async (jti: string) => (nonces.has(jti) ? false : (nonces.add(jti), true)),
    connectSandbox: async (id: string) => ({ target: `https://5173-${id}.e2b.test`, trafficToken: "traffic" }),
    fetchUpstream: (async (url: string) => new Response(`upstream ${url}`, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch,
    appOrigin: "https://www.nynz.in", frameAncestors: "https://www.nynz.in",
  };
  const host = `${P1}.preview.nynz.in`;

  it("exchanges once, sets a host-only HttpOnly cookie and redirects to a clean URL", async () => {
    const { token } = issuePreviewToken({ typ: "x", projectId: P1, userId: U1, aud: host });
    const first = await handlePreview({ method: "GET", host, url: `/__nynz/exchange?t=${token}&next=/app`, headers: {} }, deps);
    expect(first.status).toBe(303);
    expect(first.headers.location).toBe("/app");
    expect(first.headers["set-cookie"]).toMatch(new RegExp(`^${SESSION_COOKIE}=.+HttpOnly; Secure; SameSite=None; Partitioned`));
    expect(first.headers["set-cookie"]).not.toMatch(/Domain=/i);
    const replay = await handlePreview({ method: "GET", host, url: `/__nynz/exchange?t=${token}`, headers: {} }, deps);
    expect(replay.status).toBe(401);
    const cookie = first.headers["set-cookie"].split(";")[0];
    const page = await handlePreview({ method: "GET", host, url: "/app?x=1", headers: { cookie } }, deps);
    expect(page.status).toBe(200);
    expect(String(page.body && Buffer.from(page.body as ArrayBuffer))).toBe("upstream https://5173-sbx-1111.e2b.test/app?x=1");
    expect(page.headers["content-security-policy"]).toBe("frame-ancestors https://www.nynz.in");
  });

  it("rejects another project's session on this project's origin and another user's grant", async () => {
    const { token } = issuePreviewToken({ typ: "s", projectId: P2, userId: U2, aud: host });
    expect((await handlePreview({ method: "GET", host, url: "/", headers: { cookie: `${SESSION_COOKIE}=${token}` } }, deps)).status).toBe(403);
    const forged = issuePreviewToken({ typ: "x", projectId: P1, userId: U2, aud: host });
    expect((await handlePreview({ method: "GET", host, url: `/__nynz/exchange?t=${forged.token}`, headers: {} }, deps)).status).toBe(403);
    const otherHost = issuePreviewToken({ typ: "s", projectId: P1, userId: U1, aud: `${P2}.preview.nynz.in` });
    expect((await handlePreview({ method: "GET", host, url: "/", headers: { cookie: `${SESSION_COOKIE}=${otherHost.token}` } }, deps)).status).toBe(401);
  });

  it("never accepts a session token in the URL", async () => {
    const { token } = issuePreviewToken({ typ: "s", projectId: P1, userId: U1, aud: host });
    expect((await handlePreview({ method: "GET", host, url: `/?ny_session=${token}`, headers: {} }, deps)).status).toBe(401);
  });

  it("sends expired page loads back through the app to renew", async () => {
    const { token } = issuePreviewToken({ typ: "s", projectId: P1, userId: U1, aud: host, now: Date.now() - 7 * 3600_000 });
    const result = await handlePreview({ method: "GET", host, url: "/page", headers: { cookie: `${SESSION_COOKIE}=${token}`, accept: "text/html" } }, deps);
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(`https://www.nynz.in/api/projects/${P1}/preview-session?next=%2Fpage`);
  });
});
