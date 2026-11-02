import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, type Browser, type Page } from "playwright-core";
import { redact } from "../lib/platform/redact";

config({ path: ".env.local", quiet: true });
const origin = process.env.VERIFY_APP_ORIGIN || "https://www.nynz.in";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let browser: Browser | undefined;
let userId = "";
let projectId = "";
const failures: Array<{ screen: string; text: string; contrast: number }> = [];

// A literal browser function avoids transpiler helpers crossing into the page.
const auditExpression = String.raw`(() => {
  function rgba(value) { const n=(value.match(/[\d.]+/g)||[]).map(Number); return [n[0]||0,n[1]||0,n[2]||0,n.length>3?n[3]:1]; }
  function mix(top,bottom) { return [0,1,2].map(i=>top[i]*top[3]+bottom[i]*(1-top[3])); }
  function lum(rgb) { const c=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)}); return c[0]*.2126+c[1]*.7152+c[2]*.0722; }
  function background(element) {
    const layers=[]; const rect=element.getBoundingClientRect(); const x=rect.left+rect.width/2; const y=rect.top+rect.height/2;
    for(let e=element;e;e=e.parentElement) {
      const style=getComputedStyle(e); const paints=[rgba(style.backgroundColor)];
      if(style.backgroundImage.includes('linear-gradient')) { const first=style.backgroundImage.match(/rgba?\([^)]*\)/); if(first)paints.push(rgba(first[0])); }
      for(const child of e.children) {
        const c=getComputedStyle(child); if(c.position!=='absolute')continue;
        const r=child.getBoundingClientRect(); if(x<r.left||x>r.right||y<r.top||y>r.bottom)continue;
        const color=rgba(c.backgroundColor); if(color[3]>0)paints.push(color);
      }
      layers.push(paints);
    }
    return layers.reverse().reduce((base,paints)=>paints.reduce((b,p)=>mix(p,b),base),[7,11,18]);
  }
  const issues=[]; let checked=0;
  for(const element of document.querySelectorAll('.nynz-dark :is(p,label,input,textarea,button,summary,span,h1,h2,h3,a)')) {
    if(!element.getClientRects().length || element.closest('[disabled],[aria-hidden="true"],.sr-only'))continue;
    const style=getComputedStyle(element); if(style.visibility==='hidden'||style.backgroundClip==='text'||style.webkitBackgroundClip==='text')continue;
    let hidden=false; for(let e=element;e;e=e.parentElement)if(Number(getComputedStyle(e).opacity)<.98)hidden=true;
    if(hidden)continue;
    const isField=element.matches('input,textarea');
    const text=isField?(element.value||element.getAttribute('placeholder')||''):Array.from(element.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
    if(!text.trim())continue;
    const foreground=rgba(isField&&!element.value?getComputedStyle(element,'::placeholder').color:style.color);
    const bg=background(element); const fg=mix(foreground,bg); const l1=lum(fg); const l2=lum(bg);
    const contrast=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700);
    checked++;
    if(contrast<(large?3:4.5))issues.push({text:text.trim().slice(0,80),contrast:Number(contrast.toFixed(2))});
  }
  return {checked,issues};
})()`;

async function audit(page: Page, screen: string) {
  await page.waitForTimeout(1200);
  const result = await page.evaluate(auditExpression) as { checked: number; issues: Array<{ text: string; contrast: number }> };
  failures.push(...result.issues.map(issue => ({ screen, ...issue })));
  console.log(JSON.stringify({ screen, checked: result.checked, issues: result.issues }));
}

try {
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const publicPage = await anonymous.newPage();
  for (const [path, label] of [["/", "homepage"], ["/login", "login"], ["/visibility-not-found-check", "not-found"]]) {
    await publicPage.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
    await audit(publicPage, label);
  }
  const email = `nynz-visibility-${randomUUID()}@example.invalid`;
  const password = `Nynz-${randomUUID()}-1a!`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Could not create visibility verification user");
  userId = created.data.user.id;
  let cookies: Array<{ name: string; value: string }> = [];
  const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => cookies, setAll: values => { cookies = values.map(({ name, value }) => ({ name, value })); } } });
  if ((await auth.auth.signInWithPassword({ email, password })).error) throw new Error("Could not sign in visibility verification user");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(cookies.map(cookie => ({ ...cookie, url: origin, httpOnly: false, secure: origin.startsWith("https:"), sameSite: "Lax" as const })));
  const { data: project, error } = await db.from("projects").insert({ owner_id: userId, name: "Visibility verification", status: "planning" }).select("id").single();
  if (error || !project) throw new Error("Could not create visibility verification project");
  projectId = project.id;
  const { data: conversation } = await db.from("conversations").insert({ project_id: projectId }).select("id").single();
  if (conversation) await db.from("messages").insert({ conversation_id: conversation.id, role: "user", content: "Build a polished responsive application with clear typography, accessible forms, and a useful dashboard." });
  await db.from("build_jobs").insert({ project_id: projectId, requested_by: userId, conversation_id: conversation?.id, prompt: "Visibility verification only; no code generation", mode: "create", status: "planning", plan: { approval: "awaiting", revision: 1, summary: "Create a focused application with clear typography, readable inputs and a responsive layout.", steps: ["Create the primary workflow with meaningful content.", "Use accessible input labels and helpful empty states.", "Design the mobile layout with generous touch targets.", "Check the production build and live preview."] }, idempotency_key: randomUUID() });
  const page = await context.newPage();
  await page.goto(`${origin}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.locator('main[data-dashboard-ready="true"]').waitFor();
  await audit(page, "dashboard");
  await page.getByRole("button", { name: "Rename Visibility verification", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name", exact: true }).waitFor();
  await audit(page, "rename-dialog");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(`${origin}/projects/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.locator('main[data-builder-ready="true"]').waitFor();
  await audit(page, "plan-review");
  await page.getByRole("button", { name: "Edit plan", exact: true }).click();
  await audit(page, "plan-editing");
  await page.screenshot({ path: "/tmp/nynz-plan-contrast-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Project settings", exact: true }).click();
  await audit(page, "project-settings");
  await page.keyboard.press("Escape");
  const closeSettings = page.getByRole("button", { name: "Close settings", exact: true });
  if (await closeSettings.count()) await closeSettings.click();
  await page.goto(`${origin}/projects/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('main[data-builder-ready="true"]').waitFor();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await audit(page, "phone-plan-review");
  await page.screenshot({ path: "/tmp/nynz-plan-contrast-phone.png", fullPage: true });
  if (failures.length) throw new Error(`${failures.length} text contrast issues found`);
  console.log("PASS: audited functional text, labels and placeholders across public screens, dashboard, plan review, editing, rename, settings and phone layout");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  if (projectId) await db.from("projects").delete().eq("id", projectId);
  if (userId) await db.auth.admin.deleteUser(userId);
  await browser?.close();
  console.log("Disposable visibility verification resources cleaned up");
}
