/**
 * Production verification in the owner's own signed-in session (created by
 * scripts/ops/owner-browser.ts). Owner actions go through the real console
 * forms or the same /api/admin/actions endpoint the forms call, so every
 * server and database permission check applies. Fixture staff accounts use the
 * reserved .invalid domain (no email is sent) and are deleted afterwards.
 *
 *   NYNZ_OWNER_PROFILE=… tsx scripts/ops/verify-owner-console.ts sensitive|layout
 */
import "dotenv/config";
import { config } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
import { BASE, ownerContext, whoAmI } from "./owner-browser";

config({ path: ".env.local", quiet: true });
const OWNER_ID = "41080a24-57a9-4686-8d53-c0a3a9e09588";
const OUT = process.env.NYNZ_EVIDENCE_DIR || "/tmp/nynz-evidence";
mkdirSync(OUT, { recursive: true });
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

async function action(page: Page, name: string, input: Record<string, unknown>) {
  return page.evaluate(async ([a, i]) => {
    const r = await fetch("/api/admin/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, [name, input] as const);
}
const istLocal = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16);

async function fixture(label: string) {
  const email = `verify-${label}-${randomUUID().slice(0, 6)}@nynz-verify.invalid`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error("fixture");
  return { id: data.user.id, email, password };
}
async function fixtureBrowser(f: { email: string; password: string }) {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", f.email); await page.fill("#password", f.password);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  return { browser, page };
}
const status = async (page: Page, path: string) => (await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }))?.status() ?? 0;

async function sensitive() {
  const context = await ownerContext(true);
  const me = await whoAmI(context);
  check("owner session is the exact verified NYNZ owner", me.signedIn && me.email === "adib@nynz.in" && me.userId === OWNER_ID, me.email || "not signed in");
  if (!me.signedIn || me.email !== "adib@nynz.in" || me.userId !== OWNER_ID) return context.close();
  const page = await context.newPage();

  // 1. Combined ₹50 fixed-window cap through the Providers form.
  const priorCap = (await service.from("spend_limits").select("id").eq("name","Release verification ₹50 (all providers)").eq("active",true).maybeSingle()).data;
  if (!priorCap) {
  await page.goto(`${BASE}/admin/providers`, { waitUntil: "networkidle" });
  await page.locator("summary", { hasText: "Add a limit" }).click();
  const form = page.locator("details", { has: page.locator("summary", { hasText: "Add a limit" }) }).locator("form");
  await form.getByLabel("Name").fill("Release verification ₹50 (all providers)");
  await form.getByLabel("Period").selectOption("window");
  await form.getByLabel("Limit in ₹").fill("50");
  await form.getByLabel("Window start").fill(istLocal(new Date(Date.now() - 60_000)));
  await form.getByLabel("Window end").fill(istLocal(new Date(Date.now() + 3 * 86400_000)));
  await form.getByLabel("Reason").fill("Combined cap before paid release verification");
  await form.getByRole("button", { name: "Save limit" }).click();
  await form.getByText("Done.").waitFor({ timeout: 20_000 }).catch(() => undefined);
  }
  const { data: cap } = await service.from("spend_limits").select("*").eq("name", "Release verification ₹50 (all providers)").eq("active", true).maybeSingle();
  check("₹50 combined fixed-window cap saved from the console", Boolean(cap && cap.limit_paise === 5000 && cap.period === "window" && cap.provider === null && new Date(cap.window_start) <= new Date() && new Date(cap.window_end) > new Date()), cap ? `${cap.limit_paise} paise, ${cap.window_start} → ${cap.window_end}` : "missing");
  if (!cap) { console.log("Stopping: the real owner must complete the console's password confirmation before paid testing."); return context.close(); }
  const { count: capAudit } = await service.from("admin_audit_log").select("id", { count: "exact", head: true }).eq("action", "spend_limit.saved").eq("actor_id", OWNER_ID);
  check("cap change is in the audit history with the owner as actor", (capAudit || 0) >= 1);

  // 2. Explicit, expiring owner testing allowance through the Credits form.
  const priorGrant = (await service.from("credit_grants").select("id").eq("user_id",OWNER_ID).eq("source","owner_testing").eq("reason","Owner testing allowance for release verification (₹50 cap)").limit(1).maybeSingle()).data;
  if (!priorGrant) {
  await page.goto(`${BASE}/admin/credits`, { waitUntil: "networkidle" });
  const grant = page.locator("form", { has: page.getByRole("button", { name: "Grant owner testing credits" }) });
  await grant.getByLabel("Credits").fill("50");
  await grant.getByLabel("Expires").fill(istLocal(new Date(Date.now() + 3 * 86400_000)));
  await grant.getByLabel("Reason").fill("Owner testing allowance for release verification (₹50 cap)");
  await grant.getByRole("button", { name: "Grant owner testing credits" }).click();
  await grant.getByText("Done.").waitFor({ timeout: 20_000 }).catch(() => undefined);
  }
  const { data: bal } = await service.rpc("credit_balance", { p_user: OWNER_ID });
  check("owner testing allowance granted and expiring", Number(bal?.owner_testing) >= 50, JSON.stringify(bal));
  if (Number(bal?.owner_testing) < 50) return context.close();

  // 3. Team workflow with disposable fixtures.
  const staff = await fixture("support");
  const other = await fixture("revoked");
  try {
    await page.goto(`${BASE}/admin/team`, { waitUntil: "networkidle" });
    const invite = page.locator("form", { has: page.getByRole("button", { name: "Send invitation" }) });
    await invite.getByLabel("Email").fill(staff.email);
    await invite.getByLabel("Name (optional)").fill("Verification fixture");
    await invite.getByLabel("Role").selectOption("support");
    await invite.getByLabel("Reason").fill("Release verification fixture");
    await invite.getByRole("button", { name: "Send invitation" }).click();
    await invite.getByText("Done.").waitFor({ timeout: 20_000 }).catch(() => undefined);
    const { data: inv } = await service.from("staff_invitations").select("id,status,last_delivery,role").eq("email", staff.email).maybeSingle();
    check("owner invites a person from the Team form", inv?.status === "pending" && inv.role === "support", JSON.stringify(inv));
    check("existing account is linked in-app with no email sent", inv?.last_delivery === "in_app_only", inv?.last_delivery || "");

    const f = await fixtureBrowser(staff);
    check("no staff access before acceptance", (await status(f.page, "/admin")) === 404);
    await f.page.goto(`${BASE}/account/invitations`, { waitUntil: "networkidle" });
    await f.page.getByRole("button", { name: "Accept invitation" }).click();
    await f.page.getByText("Open the admin console").waitFor({ timeout: 20_000 });
    check("fixture accepts while signed in to the invited, verified address", (await status(f.page, "/admin")) === 200);
    check("support can open Users", (await status(f.page, "/admin/users")) === 200);
    check("support cannot open Plans and payments", (await status(f.page, "/admin/billing")) === 404);
    check("support cannot open Team", (await status(f.page, "/admin/team")) === 404);
    await f.page.goto(`${BASE}/admin`);
    check("support cannot suspend accounts", (await action(f.page, "user.status", { userId: other.id, status: "suspended", reason: "probe" })).status === 403);
    check("support cannot invite staff (no self-escalation path)", (await action(f.page, "team.invite", { email: "x@nynz-verify.invalid", role: "owner", reason: "probe" })).status === 403);
    const over = await action(f.page, "credits.grant", { userId: other.id, amount: 500, source: "promotional", expiresAt: new Date(Date.now() + 3600_000).toISOString(), reason: "limit probe", idempotencyKey: randomUUID() });
    check("support grant above role limit is refused", over.status === 403 && /limit/i.test(over.body.error || ""), `${over.status} ${over.body.error || ""}`);

    await f.page.setViewportSize({ width:390,height:844 });
    check("support Users section works at phone width", (await status(f.page,"/admin/users"))===200 && await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    for (const role of ["operations","billing"] as const) {
      const current = (await service.from("staff_members").select("version").eq("user_id",staff.id).single()).data!;
      check(`owner changes fixture to ${role}`, (await action(page,"team.update",{userId:staff.id,role,extra:[],revoked:[],requireMfa:null,expectedVersion:current.version,reason:"Release role verification"})).status===200);
      check(`${role} provider access`, (await status(f.page,"/admin/providers"))===200);
      check(`${role} billing permission`, (await status(f.page,"/admin/billing"))===(role==="billing"?200:404));
      check(`${role} cannot manage staff`, (await action(f.page,"team.invite",{email:"probe@nynz-verify.invalid",role:"support",reason:"Permission probe"})).status===403);
      if (role==="operations") check("operations cannot grant credits", (await action(f.page,"credits.grant",{userId:other.id,amount:1,source:"promotional",expiresAt:null,reason:"Permission probe",idempotencyKey:randomUUID()})).status===403);
      else check("billing cannot suspend a user", (await action(f.page,"user.status",{userId:other.id,status:"suspended",reason:"Permission probe"})).status===403);
    }

    const { data: row } = await service.from("staff_members").select("version").eq("user_id", staff.id).single();
    const toReadonly = await action(page, "team.update", { userId: staff.id, role: "readonly", extra: [], revoked: [], requireMfa: null, expectedVersion: row!.version, reason: "Verification role change" });
    check("owner changes the fixture's role", toReadonly.status === 200, String(toReadonly.status));
    check("role change applies to the fixture's next request (readonly cannot grant)", (await action(f.page, "credits.grant", { userId: OWNER_ID, amount: 1, source: "promotional", expiresAt: null, reason: "probe", idempotencyKey: randomUUID() })).status === 403);
    check("readonly can open Audit history", (await status(f.page, "/admin/audit")) === 200);

    check("owner suspends staff access", (await action(page, "team.status", { userId: staff.id, status: "suspended", reason: "Verification suspension" })).status === 200);
    check("suspension revokes access in the existing session", (await status(f.page, "/admin")) === 404);
    check("suspended staff keeps their normal workspace", (await status(f.page, "/dashboard")) === 200);
    check("owner reactivates staff access", (await action(page, "team.status", { userId: staff.id, status: "active", reason: "Verification reactivation" })).status === 200);
    check("reactivation restores access", (await status(f.page, "/admin")) === 200);
    check("owner removes staff access", (await action(page, "team.status", { userId: staff.id, status: "removed", reason: "Verification complete" })).status === 200);
    check("removal revokes access in the existing session", (await status(f.page, "/admin")) === 404);
    check("removed staff keeps their normal workspace", (await status(f.page, "/dashboard")) === 200);
    await f.browser.close();

    const second = await action(page, "team.invite", { email: other.email, name: "", role: "readonly", capabilities: [], reason: "Verification revoke" });
    const revoke = await action(page, "team.revoke", { invitationId: second.body.result?.invitationId, reason: "Verification revoke" });
    const g = await fixtureBrowser(other);
    await g.page.goto(`${BASE}/account/invitations`, { waitUntil: "networkidle" });
    check("revoked invitation is not offered to the invitee", revoke.status === 200 && /no pending invitations/i.test(await g.page.locator("body").innerText()));
    await g.browser.close();
    check("owner cannot change their own staff record", (await action(page, "team.status", { userId: OWNER_ID, status: "suspended", reason: "self probe" })).status === 403);

    const { data: audit } = await service.from("admin_audit_log").select("action").in("target_id", [staff.id, inv!.id]);
    const actions = new Set((audit || []).map((a) => a.action));
    check("audit records every team change", ["staff.invitation.created", "staff.invitation.accepted", "staff.access.updated", "staff.status.suspended", "staff.status.active", "staff.status.removed"].every((a) => actions.has(a)), [...actions].join(","));
  } finally {
    for (const id of [staff.id, other.id]) { const { error } = await service.auth.admin.deleteUser(id); check(`fixture account deleted (${id.slice(0, 8)})`, !error, error?.message || ""); }
  }
  await context.close();
}

const SECTIONS = ["/admin", "/admin/users", `/admin/users/${OWNER_ID}`, "/admin/projects", "/admin/credits", "/admin/billing", "/admin/providers", "/admin/team", "/admin/audit"];
async function layout() {
  const context = await ownerContext(true);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { data: anyProject } = await service.from("projects").select("id").neq("owner_id", OWNER_ID).limit(1).maybeSingle();
  const sections = anyProject ? [...SECTIONS.slice(0, 4), `/admin/projects/${anyProject.id}`, ...SECTIONS.slice(4)] : SECTIONS;
  for (const [label, width, height] of [["desktop", 1366, 900], ["phone", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    for (const path of sections) {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        pastEdge: [...document.querySelectorAll("main section, main h1, header a, nav")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest("nav")).length,
        tables: document.querySelectorAll("table").length, forms: document.querySelectorAll("form").length,
        failed: /could not be loaded|Application error/i.test(document.body.innerText),
      }));
      const back = await page.getByRole("link", { name: /Back to workspace|Workspace/ }).first().isVisible();
      check(`${label} ${path.replace(/[0-9a-f-]{36}/, ":id")}`, response?.status() === 200 && m.overflow <= 1 && m.pastEdge === 0 && back && !m.failed, `status ${response?.status()}, overflow ${m.overflow}px, tables ${m.tables}, forms ${m.forms}`);
      await page.screenshot({ path: `${OUT}/${label}-${path.split("/").filter(Boolean).join("-").replace(/[0-9a-f-]{36}/, "id") || "admin"}.png`, fullPage: true });
    }
    await page.goto(`${BASE}/admin`);
    await page.getByRole("link", { name: /Back to workspace|Workspace/ }).first().click();
    await page.waitForURL(/\/dashboard/);
    check(`${label} Back to workspace returns to the dashboard`, true);
    const menu = page.locator("button[aria-haspopup=menu]").first();
    await menu.click();
    const adminLink = page.getByRole("menuitem", { name: "Admin console" });
    check(`${label} account menu shows Admin console`, await adminLink.isVisible());
    await page.keyboard.press("Escape");
    const owned = await page.locator("a[href^='/projects/']").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    const { data: mine } = await service.from("projects").select("id").eq("owner_id", OWNER_ID);
    const mineSet = new Set((mine || []).map((p) => `/projects/${p.id}`));
    check(`${label} workspace lists only the owner's own projects`, owned.every((href) => mineSet.has(href!)), `${owned.length} links, owner has ${mineSet.size}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label} workspace fits the screen`, overflow <= 1, `${overflow}px`);
  }
  check("no page errors in the console", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

const phase = process.argv[2];
(phase === "sensitive" ? sensitive() : phase === "layout" ? layout() : Promise.reject(new Error("usage: sensitive|layout")))
  .catch((error) => check("run", false, error instanceof Error ? error.message : String(error)))
  .finally(() => { console.log(`\n${results.filter((r) => r[1]).length}/${results.length} checks passed`); process.exit(results.every((r) => r[1]) ? 0 : 1); });
