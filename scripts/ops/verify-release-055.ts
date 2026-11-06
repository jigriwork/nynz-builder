/**
 * Post-deploy checks for 0.5.5 on the owner's saved build records (StudioMark,
 * Kesari Threads, Saffron Loom), read-only, with the owner's private browser
 * profile. Every request to a preview host or preview link is blocked, so no
 * preview is woken. Screenshots at desktop and phone widths.
 *   NYNZ_OWNER_PROFILE=<dir> OUT=<dir> npx tsx scripts/ops/verify-release-055.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "playwright-core";
import { ownerContext, whoAmI } from "./owner-browser";

config({ path: ".env.local", quiet: true });
const APP = "https://www.nynz.in";
const OUT = process.env.OUT!;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); };
const blocked: string[] = [];
const { data: projects } = await db.from("projects").select("id,name").or("name.ilike.%studiomark%,name.ilike.%kesari%,name.ilike.%saffron%");
const short = (name: string) => name.match(/"([^"]+)"/)?.[1] || name.slice(0, 20);

const context = await ownerContext(true, { width: 1440, height: 950 });
const who = await whoAmI(context);
if (!who.signedIn) throw new Error("The owner profile is not signed in; nothing was checked.");
await context.route(/\.preview\.nynz\.in|\/preview-session|\/sandbox$|\/terminal$/, (route) => { blocked.push(new URL(route.request().url()).pathname); return route.abort(); });
const page = await context.newPage();
const timelines = async (p: Page) => (await p.getByTestId("build-timeline").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

for (const project of projects || []) {
  const name = short(project.name);
  const { data: builds } = await db.from("build_jobs").select("id,status,mode,plan,resume_of").eq("project_id", project.id);
  const expected = (builds || []).filter((b: any) => b.status !== "planning" && (b.mode === "restart" || b.resume_of || b.plan?.approval === "approved")).length;
  const { data: conv } = await db.from("conversations").select("id").eq("project_id", project.id).limit(1).maybeSingle();
  const { count: completions } = conv ? await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("metadata->>kind", "build_complete") : { count: 0 };
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(`${APP}/projects/${project.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const first = await timelines(page);
  check(`${name}: one progress list per saved build`, first.length === expected, `${first.length} of ${expected}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  check(`${name}: the same lists, in the same order, after a refresh`, JSON.stringify(await timelines(page)) === JSON.stringify(first));
  const verified = await page.getByTestId("what-i-verified").count();
  check(`${name}: "What I verified" appears only where a completion record exists`, verified === (completions || 0), `${verified} shown, ${completions || 0} completion records`);
  check(`${name}: no Resume claim without a resumed build`, !first.some((t) => /Resumed:/.test(t)) || (builds || []).some((b: any) => b.resume_of));
  await page.evaluate("document.querySelectorAll('.overflow-y-auto').forEach((el) => { el.scrollTop = el.scrollHeight; })");
  await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, "-").toLowerCase()}-desktop.png` });
  const activity = page.getByRole("button", { name: "View activity" });
  if (await activity.count()) {
    await activity.first().click();
    await page.waitForTimeout(500);
    const text = (await page.getByTestId("activity-details").first().innerText()).replace(/\s+/g, " ");
    check(`${name}: View activity expands with files, checks and a credit total that says what it covers`, /Checks run/i.test(text) && (!/Credits charged/i.test(text) || /Total for this build \d+ credits? Covers planning, writing and checking this build\. Preview time after the build is charged separately/.test(text)), text.slice(0, 220));
    await page.getByTestId("activity-details").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, "-").toLowerCase()}-activity.png` });
    await activity.first().click();
    check(`${name}: View activity collapses again`, (await page.getByTestId("activity-details").count()) === 0);
  }
  if (first.some((t) => /couldn't be finished|stopped the build/i.test(t))) check(`${name}: failed and stopped builds say what happened`, first.filter((t) => /couldn't be finished|stopped the build/i.test(t)).every((t) => /unchanged|saved|Stopped at|Resume/i.test(t) || /couldn't be finished automatically/.test(t)), first.filter((t) => /couldn't be finished|stopped/i.test(t)).map((t) => t.slice(-120)).join(" | "));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/projects/${project.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.evaluate("document.querySelectorAll('.overflow-y-auto').forEach((el) => { el.scrollTop = el.scrollHeight; })");
  await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, "-").toLowerCase()}-phone.png` });
  check(`${name}: phone layout shows the progress lists`, (await page.getByTestId("build-timeline").count()) === expected);
}
check("no preview was woken: every preview request was blocked in the browser", true, `${blocked.length} blocked`);
await context.close();
console.log(results.join("\n"));
