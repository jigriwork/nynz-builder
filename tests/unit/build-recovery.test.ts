import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWithOpenRouter } from "../../lib/platform/openrouter";
import { StepFailedError } from "../../lib/platform/build-engine";

/**
 * Replays the StudioMark failure (2026-11-04) against the generator: a late
 * step asks for large screens and the provider cuts the response off at the
 * output limit. The build must keep the finished work, repair only what is
 * missing, never resend an identical request, and resume without redoing or
 * re-paying for finished files.
 */
const MANIFEST = {
  plan: { summary: "StudioMark retail workspace", steps: ["Landing", "Demo access", "Dashboard", "Products, customers, orders and reports"] },
  message: "StudioMark is ready.",
  files: [
    ["package.json", "Dependencies"], ["index.html", "Document"], ["src/main.tsx", "Entry"], ["src/App.tsx", "Routing"], ["src/index.css", "Responsive styles"],
    ["src/types.ts", "Types"], ["src/store.tsx", "localStorage store"],
    ["src/pages/Landing.tsx", "Landing"], ["src/pages/Dashboard.tsx", "Dashboard"], ["src/pages/Products.tsx", "Products"],
    ["src/pages/Customers.tsx", "Customers"], ["src/pages/Orders.tsx", "Orders"], ["src/pages/Reports.tsx", "Reports"],
  ].map(([path, purpose]) => ({ path, purpose })),
};

const page = (name: string) => `export default function ${name}(){return <section className="page ${name.toLowerCase()}"><h1>${name}</h1>${Array.from({ length: 8 }, (_, i) => `<div className="card row-${i}"><h2>${name} item ${i}</h2><p>Fictional demonstration record for the ${name.toLowerCase()} screen.</p><button type="button" className="btn">Open</button></div>`).join("")}</section>}`;
function content(path: string) {
  if (path === "package.json") return JSON.stringify({ name: "studiomark", scripts: { build: "tsc --noEmit && vite build" }, dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" }, devDependencies: { vite: "^6.1.0", "@vitejs/plugin-react": "^4.4.1", typescript: "^5.8.3" } });
  if (path === "index.html") return '<!doctype html><html><head><title>StudioMark</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
  if (path === "src/index.css") return `body{margin:0;font-family:Georgia,serif;background:#faf6ee;color:#1f1b3a}.page{padding:2rem}.card{padding:1rem;border:1px solid #ddd;border-radius:12px}.btn{background:#f59e0b;border:0;padding:.5rem 1rem}${"@media(max-width:700px){.page{padding:1rem}}".repeat(20)}`;
  if (path === "src/types.ts") return "export type Product = { id: string; name: string; stock: number };";
  if (path === "src/store.tsx") return "export const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } };";
  if (path === "src/App.tsx") return `import Landing from "./pages/Landing"; import Dashboard from "./pages/Dashboard"; import Products from "./pages/Products"; import Customers from "./pages/Customers"; import Orders from "./pages/Orders"; import Reports from "./pages/Reports";\nexport default function App(){return <main className="app"><Landing/><Dashboard/><Products/><Customers/><Orders/><Reports/></main>}`;
  const name = path.split("/").pop()!.replace(".tsx", "");
  return page(name);
}

type Body = { max_tokens: number; messages: Array<{ content: string }> };
const requested = (body: Body) => {
  const text = body.messages[1].content;
  const section = text.split("GENERATE THESE FILES NOW:\n")[1]?.split("\n\n")[0] || "";
  return section.split("\n").map((line) => line.split(":")[0]).filter(Boolean);
};
function respond(files: Array<{ path: string; content: string }>, truncateAt?: string) {
  let text = JSON.stringify({ files });
  if (truncateAt) text = text.slice(0, text.indexOf(truncateAt));
  return new Response(JSON.stringify({ id: crypto.randomUUID(), model: "anthropic/claude-sonnet-5.5", choices: [{ finish_reason: truncateAt ? "length" : "stop", message: { content: text } }], usage: { prompt_tokens: 1000, completion_tokens: truncateAt ? 20_000 : 3000, cost: 0.03 } }), { status: 200 });
}

describe("large build recovery", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("repairs a cut-off late step without repeating it and keeps every finished file", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const bodies: string[] = [];
    let ordersTries = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      bodies.push(JSON.stringify(body));
      const paths = requested(body);
      // The late step (Customers and Orders) is cut off after Customers, and
      // Orders on its own is cut off once more before it fits.
      if (paths.includes("src/pages/Orders.tsx")) {
        ordersTries += 1;
        if (paths.length > 1) return respond(paths.map((path) => ({ path, content: content(path) })), "export default function Orders");
        if (ordersTries === 2) return respond([{ path: "src/pages/Orders.tsx", content: content("src/pages/Orders.tsx") }], "Orders item 3");
      }
      return respond(paths.map((path) => ({ path, content: content(path) })));
    }));
    const steps: string[][] = [];
    const output = await generateWithOpenRouter({ prompt: "Build StudioMark", files: [], mode: "create", approvedManifest: MANIFEST, onStep: async (step) => { steps.push(step.done); } });
    const paths = output.result.files.map((file) => file.path);
    for (const file of MANIFEST.files) expect(paths).toContain(file.path);
    // Every finished file was saved exactly once.
    const saved = steps.flat();
    expect(new Set(saved).size).toBe(saved.length);
    expect(saved).toContain("src/pages/Customers.tsx");
    expect(saved).toContain("src/pages/Orders.tsx");
    // No request was ever sent twice.
    expect(new Set(bodies).size).toBe(bodies.length);
    // Orders alone got a larger allowance each time it was cut off.
    const ordersBodies = bodies.map((text) => JSON.parse(text) as Body).filter((body) => requested(body).join() === "src/pages/Orders.tsx");
    expect(ordersBodies.map((body) => body.max_tokens)).toEqual([30_000, 32_000]);
    expect(bodies.length).toBeLessThanOrEqual(MANIFEST.files.length + 4);
  });

  it("stops with finished files saved, then resumes without regenerating or recharging them", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    let providerDown = true;
    const calls: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const paths = requested(JSON.parse(String(init.body)) as Body);
      calls.push(paths);
      if (providerDown && paths.includes("src/pages/Reports.tsx")) return respond(paths.map((path) => ({ path, content: content(path) })), "export default function Reports");
      return respond(paths.map((path) => ({ path, content: content(path) })));
    }));
    const saved = new Map<string, string>();
    const paid: number[] = [];
    const first = generateWithOpenRouter({ prompt: "Build StudioMark", files: [], mode: "create", approvedManifest: MANIFEST, onUsage: async () => { paid.push(1); }, onStep: async (step) => { for (const file of step.files) saved.set(file.path, file.content); } });
    await expect(first).rejects.toBeInstanceOf(StepFailedError);
    await first.catch((error: StepFailedError) => expect(error.step.paths).toEqual(["src/pages/Reports.tsx"]));
    expect(saved.has("src/pages/Orders.tsx")).toBe(true);
    expect(saved.has("src/pages/Reports.tsx")).toBe(false);
    const firstRunCalls = calls.length;
    expect(firstRunCalls).toBeLessThanOrEqual(MANIFEST.files.length + 4);

    // Resume: only the unfinished file is requested; finished files are reused.
    providerDown = false;
    calls.length = 0;
    const resumed = await generateWithOpenRouter({ prompt: "Build StudioMark", files: [], mode: "create", approvedManifest: MANIFEST, completed: [...saved].map(([path, value]) => ({ path, content: value })), onStep: async (step) => { for (const file of step.files) saved.set(file.path, file.content); } });
    expect(calls).toEqual([["src/pages/Reports.tsx"]]);
    expect(resumed.result.files.map((file) => file.path)).toContain("src/pages/Reports.tsx");
    expect(resumed.result.files.find((file) => file.path === "src/pages/Orders.tsx")!.content).toBe(saved.get("src/pages/Orders.tsx"));
  });

  it("chained Resume: a resumed build that fails again continues from the newest saved files and never pays for them twice", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    let failing = new Set(["src/pages/Orders.tsx", "src/pages/Reports.tsx"]);
    const calls: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const paths = requested(JSON.parse(String(init.body)) as Body);
      calls.push(paths);
      const cut = paths.find((path) => failing.has(path));
      return respond(paths.map((path) => ({ path, content: content(path) })), cut ? `export default function ${cut.split("/").pop()!.replace(".tsx", "")}` : undefined);
    }));
    const saved = new Map<string, string>();
    const paidFor = new Map<string, number>();
    const run = () => generateWithOpenRouter({
      prompt: "Build StudioMark", files: [], mode: "create", approvedManifest: MANIFEST,
      completed: [...saved].map(([path, value]) => ({ path, content: value })),
      onStep: async (step) => { for (const file of step.files) { saved.set(file.path, file.content); paidFor.set(file.path, (paidFor.get(file.path) || 0) + 1); } },
    });

    // Run 1 stops at Orders (Reports is never reached).
    await expect(run()).rejects.toMatchObject({ step: { paths: ["src/pages/Orders.tsx"] } });
    const afterFirst = new Set(saved.keys());
    expect(afterFirst.has("src/pages/Orders.tsx")).toBe(false);

    // Run 2 (Resume) finishes Orders, then stops at Reports.
    failing = new Set(["src/pages/Reports.tsx"]);
    calls.length = 0;
    await expect(run()).rejects.toMatchObject({ step: { paths: ["src/pages/Reports.tsx"] } });
    expect(calls.flat().every((path) => !afterFirst.has(path))).toBe(true);
    expect(saved.has("src/pages/Orders.tsx")).toBe(true);
    const ordersAfterSecond = saved.get("src/pages/Orders.tsx");

    // Run 3 (Resume again) asks only for Reports and reuses Orders from run 2.
    failing = new Set();
    calls.length = 0;
    const output = await run();
    expect(calls).toEqual([["src/pages/Reports.tsx"]]);
    expect(output.result.files.find((file) => file.path === "src/pages/Orders.tsx")!.content).toBe(ordersAfterSecond);
    // Every finished file was produced (and so paid for) exactly once across all three runs.
    expect([...paidFor.values()].every((count) => count === 1)).toBe(true);
    expect([...paidFor.keys()].sort()).toEqual(MANIFEST.files.map((file) => file.path).filter((path) => path !== "src/main.tsx").sort());
  });

  it("edits a large change file by file and splits a step that is cut off", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const current = MANIFEST.files.map((file) => ({ path: file.path, content: content(file.path) }));
    const editManifest = { plan: { summary: "Premium look", steps: ["Restyle screens"] }, message: "Updated", files: ["src/pages/Products.tsx", "src/pages/Orders.tsx", "src/pages/Reports.tsx"].map((path) => ({ path, purpose: "Restyle" })) };
    const groups: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      const text = body.messages[1].content;
      const group = (text.match(/EDIT ONLY THESE FILES IN THIS STEP: (.+?)\. Make every/)?.[1] || "").split(", ").filter(Boolean);
      groups.push(group);
      const edits = group.map((path) => ({ path, search: "<h1>", replace: '<h1 className="premium">' }));
      const value = JSON.stringify({ plan: editManifest.plan, message: "ok", edits });
      const cut = group.length > 1;
      return new Response(JSON.stringify({ id: crypto.randomUUID(), model: "anthropic/claude-sonnet-5.5", choices: [{ finish_reason: cut ? "length" : "stop", message: { content: cut ? value.slice(0, 40) : value } }], usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.001 } }), { status: 200 });
    }));
    const done: string[] = [];
    const output = await generateWithOpenRouter({ prompt: "Make every screen look premium", files: current, mode: "edit", approvedManifest: editManifest, onStep: async (step) => { done.push(...step.done); } });
    expect(done.sort()).toEqual(editManifest.files.map((file) => file.path).sort());
    expect(output.result.files.every((file) => file.content.includes('className="premium"'))).toBe(true);
    expect(groups.some((group) => group.length > 1)).toBe(true);
    expect(groups.filter((group) => group.length === 1).length).toBe(3);
  });
});
