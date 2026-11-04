/**
 * Measures typing responsiveness in a prompt box with a simulated mid-range
 * phone (4x CPU slowdown, 390px viewport): per-keystroke event duration
 * (Event Timing API), dropped frames while typing, and long main-thread tasks.
 *   NYNZ_PERF_URL=https://www.nynz.in/ tsx scripts/perf/typing-latency.ts [cookie]
 */
import { chromium } from "playwright-core";

export async function measureTyping(url: string, opts: { selector?: string; cookie?: { name: string; value: string; domain: string }; label?: string; cpu?: number } = {}) {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  if (opts.cookie) await context.addCookies([{ ...opts.cookie, path: "/", secure: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: opts.cpu ?? 4 });
  const box = page.locator(opts.selector || "textarea").first();
  await box.click();
  await cdp.send("Performance.enable");
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
  const idleStart = await metric();
  await page.waitForTimeout(3000);
  const idleEnd = await metric();
  const idleBusyPct = Math.round(((idleEnd.TaskDuration - idleStart.TaskDuration) / 3) * 100);
  // Plain JavaScript text: the TypeScript runner would otherwise inject helpers the page lacks.
  await page.evaluate(`(() => {
    window.__perf = { events: [], longTasks: [], frames: [] };
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (["keydown","keypress","input","keyup"].includes(e.name)) window.__perf.events.push(e.duration); }).observe({ type: "event", durationThreshold: 16, buffered: false });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.longTasks.push(e.duration); }).observe({ type: "longtask" });
    let last = performance.now();
    const tick = (t) => { window.__perf.frames.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })()`);
  await page.keyboard.type("Build a booking app for a yoga studio with a weekly timetable and waitlists", { delay: 60 });
  await page.waitForTimeout(500);
  const perf = await page.evaluate("window.__perf") as { events: number[]; longTasks: number[]; frames: number[] };
  await browser.close();
  const sorted = [...perf.events].sort((a, b) => a - b);
  const p = (q: number) => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]) : 0;
  const frames = perf.frames.slice(5);
  return {
    label: opts.label || url, idleBusyPct,
    slowKeyEvents: sorted.length, p50: p(.5), p95: p(.95), worst: Math.round(sorted.at(-1) || 0),
    longTasks: perf.longTasks.length, longTaskMs: Math.round(perf.longTasks.reduce((a, b) => a + b, 0)),
    droppedFramePct: Math.round((frames.filter((f) => f > 34).length / Math.max(1, frames.length)) * 100),
    avgFrameMs: Math.round(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  measureTyping(process.env.NYNZ_PERF_URL || "https://www.nynz.in/").then((r) => console.log(JSON.stringify(r)));
}
