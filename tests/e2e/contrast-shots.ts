/**
 * Screenshots of public and signed-in pages on a local app (default
 * http://127.0.0.1:3300) for a readability review. Local Supabase only.
 *   L_API_URL=… L_SERVICE_ROLE_KEY=… OUT=<dir> npx tsx tests/e2e/contrast-shots.ts
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
const APP = process.env.APP || "http://127.0.0.1:3300";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.L_API_URL || "")) throw new Error("local Supabase only");
const admin = createClient(process.env.L_API_URL!, process.env.L_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const email = `contrast-${Date.now()}@example.com`, password = `Pw-${randomUUID()}`;
const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const userId = data.user!.id;
await admin.rpc("grant_credits", { p_user: userId, p_source: "promotional", p_amount: 60, p_expires_at: null, p_reason: "Welcome trial credits", p_actor: null, p_idempotency: `c:${userId}` });
const { data: project } = await admin.from("projects").insert({ owner_id: userId, name: "Readability check" }).select("id").single();
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (path: string, name: string) => { await page.goto(`${APP}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500); await page.screenshot({ path: `${process.env.OUT}/${name}.png` }); };
for (const [p, n] of [["/", "home"], ["/login", "login"], ["/login?mode=signup", "invite"], ["/forgot-password", "forgot"], ["/pricing", "pricing"], ["/privacy", "privacy"]]) await shot(p, n);
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#email", email); await page.fill("#password", password);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
for (const [p, n] of [["/dashboard", "dashboard"], [`/projects/${project!.id}`, "builder"], ["/billing", "billing"], ["/account/security", "security"]]) await shot(p, n);
await browser.close();
console.log("done");
