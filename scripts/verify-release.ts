/**
 * Post-deploy verification for release 0.3, against a deployed environment
 * where the 0.3 migrations are applied. Uses only disposable fixture accounts
 * on the reserved ".invalid" domain (no email is ever delivered), spends no
 * provider money (no generation is requested), and deletes its fixtures.
 *
 *   NYNZ_VERIFY_BASE_URL=https://www.nynz.in pnpm verify:release
 *
 * It does not create owner or staff accounts in production: owner and team
 * checks are listed at the end for the owner to perform with their own login.
 */
import "dotenv/config";
import { config } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
const base = (process.env.NYNZ_VERIFY_BASE_URL || "").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
if (!base || !url || !publishable) throw new Error("Set NYNZ_VERIFY_BASE_URL and Supabase configuration");

const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const created: string[] = [];

async function fixtureUser(label: string) {
  const email = `release-${label}-${randomUUID().slice(0, 8)}@nynz-verify.invalid`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error("fixture user");
  created.push(data.user.id);
  const client = createClient(url, publishable, { auth: { persistSession: false } });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !session.session) throw signInError || new Error("fixture sign-in");
  // @supabase/ssr stores the session in a base64 cookie named sb-<ref>-auth-token.
  const ref = new URL(url).hostname.split(".")[0];
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session.session)).toString("base64url")}`;
  return { id: data.user.id, client, cookie };
}

async function api(user: { cookie: string } | null, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual", headers: { ...(user ? { cookie: user.cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: response.status, json, text };
}

async function main() {
  const owner = await admin.from("staff_members").select("role,status,email").eq("user_id", "41080a24-57a9-4686-8d53-c0a3a9e09588").maybeSingle();
  check("owner record for 41080a24-… / adib@nynz.in", owner.data?.role === "owner" && owner.data?.status === "active" && owner.data?.email === "adib@nynz.in", owner.error ? "staff table missing: migrations not applied" : owner.data ? `${owner.data.role}/${owner.data.status}` : "not bootstrapped");

  const alice = await fixtureUser("alice");
  const bob = await fixtureUser("bob");
  const created1 = await api(alice, "/api/projects", "POST", { name: "Release fixture" });
  check("customer can create a project", created1.status === 201, String(created1.status));
  const projectId = created1.json?.project?.id;

  for (const column of ["active_sandbox_id", "status", "preview_url", "source_revision"]) {
    const { error } = await alice.client.from("projects").update({ [column]: column === "source_revision" ? 0 : "x" }).eq("id", projectId);
    check(`owner cannot write managed column ${column} via the Data API`, Boolean(error), error?.code);
  }
  const { data: bobsView } = await bob.client.from("projects").select("id").eq("id", projectId);
  check("another customer cannot read the project", (bobsView || []).length === 0);
  for (const [path, method] of [[`/api/projects/${projectId}`, "GET"], [`/api/projects/${projectId}/files`, "GET"], [`/api/projects/${projectId}/preview-session`, "POST"], [`/api/projects/${projectId}/terminal`, "POST"], [`/api/projects/${projectId}/export`, "GET"]] as const) {
    const res = await api(bob, path, method, method === "POST" ? { command: "id" } : undefined);
    check(`cross-user ${method} ${path.replace(projectId, ":id")} is refused`, res.status === 404, String(res.status));
  }
  const resources = await bob.client.from("platform_resources").select("*").limit(1);
  check("customers cannot read the resource registry", Boolean(resources.error));
  const audit = await bob.client.from("admin_audit_log").select("id").limit(1);
  check("customers see no audit history", !audit.error && (audit.data || []).length === 0);

  const adminPage = await api(alice, "/admin");
  check("customer receives 404 for /admin", adminPage.status === 404, String(adminPage.status));
  const adminAction = await api(alice, "/api/admin/actions", "POST", { action: "user.status", input: { userId: bob.id, status: "suspended", reason: "probe" } });
  check("customer cannot call admin actions", adminAction.status === 403, String(adminAction.status));
  const rpc = await alice.client.rpc("admin_set_account_status", { p_user: bob.id, p_status: "suspended", p_reason: "probe" });
  check("customer cannot call admin database functions", Boolean(rpc.error), rpc.error?.message);
  const grant = await alice.client.rpc("grant_credits", { p_user: alice.id, p_source: "purchased", p_amount: 1000, p_expires_at: null, p_reason: "x", p_actor: null, p_idempotency: randomUUID() });
  check("customer cannot grant themselves credits", Boolean(grant.error));

  const save = await api(alice, `/api/projects/${projectId}/files`, "PUT", { files: [{ path: "README.md", content: "# Mine", baseHash: null }] });
  check("conflict-checked save works", save.status === 200, String(save.status));
  const stale = await api(alice, `/api/projects/${projectId}/files`, "PUT", { files: [{ path: "README.md", content: "# Other tab", baseHash: null }] });
  check("stale concurrent save is rejected", stale.status === 409, String(stale.status));
  const zip = await fetch(`${base}/api/projects/${projectId}/export`, { headers: { cookie: alice.cookie } });
  check("export succeeds", zip.ok, String(zip.status));
  const unknownApi = await api(alice, "/api/generate-ai-code-stream", "POST", {});
  check("legacy API paths are gone", unknownApi.status === 404, String(unknownApi.status));
  for (const asset of ["/firecrawl.svg", "/firecrawl-logo"]) check(`${asset} is not served`, (await fetch(`${base}${asset}`)).status === 404);
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  check("robots.txt excludes private routes", /Disallow: \/admin/.test(robots) && /Disallow: \/dashboard/.test(robots));
  const home = await (await fetch(base)).text();
  check("homepage has NYNZ canonical and Open Graph metadata", /rel="canonical"/.test(home) && /property="og:title"/.test(home));
  check("homepage has no inherited identity", !/open[\s-]?lovable|firecrawl/i.test(home));
  const del = await api(alice, `/api/projects/${projectId}`, "DELETE");
  check("project deletion queues resource cleanup", del.status === 204, String(del.status));
}

main().catch((error) => check("verification run", false, error instanceof Error ? error.message : String(error))).finally(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  console.log(`\n${results.filter((r) => r[1]).length}/${results.length} checks passed; ${created.length} fixture accounts removed.`);
  console.log(`\nManual owner checks (use your own login, no shared credentials):
  1. Sign in as adib@nynz.in, open the account menu: "Admin console" is present; open it, then "Back to workspace".
  2. Admin → Team → Add a team member with a disposable address you control; accept it from that account; change its role; suspend; remove.
  3. Admin → Credits → grant owner testing credits (expiring, within budget).
  4. Admin → Providers → confirm the spending limits and add the verification cap before any paid test.
  5. Account security → set up an authenticator app.`);
  process.exit(results.every((r) => r[1]) ? 0 : 1);
});
