import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWithOpenRouter, planApplication } from "../../lib/platform/openrouter";
import { normalizeGeneratedFile, validateCreateDependencies, validateLocalImports } from "../../lib/platform/sarvam";
import { FIXED_STARTER_PATHS } from "../../lib/platform/starter";

function reply(value: unknown, cost = 0.01) {
  return new Response(JSON.stringify({
    model: "openai/gpt-5",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, cost },
  }), { status: 200, headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() } });
}

describe("OpenRouter staged generation", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("plans, generates bounded batches and reports every paid call", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const manifest = {
      plan: { summary: "A complete storefront", steps: ["Plan", "Build", "Verify"] },
      message: "Your storefront is ready.",
      files: [
        { path: "package.json", purpose: "Dependencies" }, { path: "index.html", purpose: "Document" },
        { path: "tsconfig.json", purpose: "TypeScript" }, { path: "vite.config.ts", purpose: "Vite" },
        { path: "src/main.tsx", purpose: "Entry" }, { path: "src/App.tsx", purpose: "Product UI" },
        { path: "src/index.css", purpose: "Responsive styling" }, { path: "src/data.ts", purpose: "Demo data" },
      ],
    };
    const appSections = Array.from({ length: 45 }, (_, index) => `<section className="card"><h2>Collection ${index}</h2><p>Thoughtfully written product information for a complete shopping experience.</p><button type="button">Explore</button></section>`).join("");
    const batches = [
      { files: [
        { path: "package.json", content: JSON.stringify({ scripts: { build: "tsc && vite build" }, dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", typescript: "latest", react: "latest", "react-dom": "latest" }, devDependencies: {} }) },
        { path: "index.html", content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>' },
        { path: "tsconfig.json", content: JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "ESNext", target: "ES2022" }, include: ["src"] }) },
        { path: "vite.config.ts", content: 'import{defineConfig}from"vite";import react from"@vitejs/plugin-react";export default defineConfig({plugins:[react()]});' },
      ] },
      { files: [
        { path: "src/main.tsx", content: 'import{createRoot}from"react-dom/client";import App from"./App";import"./index.css";createRoot(document.getElementById("root")!).render(<App/>);' },
        { path: "src/App.tsx", content: `export default function App(){return <main className="app"><header className="hero"><h1>Aster House</h1></header>${appSections}<footer className="footer">Made with care</footer></main>}` },
        { path: "src/index.css", content: `*{box-sizing:border-box}body{margin:0;background:#f7f2e8;color:#271b18;font-family:Arial,sans-serif}.app{min-height:100vh}.hero{padding:5rem}.card{padding:2rem;border:1px solid #ddd}.footer{padding:3rem}@media(max-width:700px){.hero{padding:2rem}.card{padding:1rem}}${".card button{border:0;padding:1rem;background:#6d2031;color:white;border-radius:2rem}".repeat(15)}` },
        { path: "src/data.ts", content: "export const categories=['Skin','Body','Ritual'];" },
      ] },
    ];
    const productFiles = batches.flatMap(batch => batch.files).filter(file => !FIXED_STARTER_PATHS.has(file.path));
    const responses = [reply(manifest), reply({ files: productFiles.slice(0, 4) }), reply({ files: productFiles.slice(4) })];
    const fetchMock = vi.fn(async () => responses.shift() || reply({ files: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const paidCalls: unknown[] = [];
    const output = await generateWithOpenRouter({ prompt: "Build a polished store", files: [], mode: "create", onUsage: async (event) => { paidCalls.push(event); } });
    expect(output.result.files).toHaveLength(9);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(paidCalls).toHaveLength(3);
    expect(output.usage.costUsd).toBeCloseTo(0.03);
  });

  it("produces a reviewable plan without generating any source code", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const manifest = { plan: { summary: "Calculator with keyboard input", steps: ["Arithmetic", "Keyboard input"] }, message: "Review your calculator plan", files: ["package.json", "index.html", "src/main.tsx", "src/App.tsx", "src/index.css"].map(path => ({ path, purpose: path })) };
    const fetchMock = vi.fn(async () => reply(manifest));
    vi.stubGlobal("fetch", fetchMock);
    const planned = await planApplication({ prompt: "Build a calculator" });
    expect(planned.manifest.plan.steps).toEqual(["Arithmetic", "Keyboard input"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(requestBody.provider.max_price).toMatchObject({ prompt: 2, completion: 10, request: 0 });
    expect(planned.manifest.files.every(file => !("content" in file))).toBe(true);
  });

  it("allows a one-file edit plan without demanding unrelated app entry points", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.stubGlobal("fetch", vi.fn(async () => reply({ plan: { summary: "Change the heading", steps: ["Update the heading and preserve arithmetic"] }, message: "Review the change", files: [{ path: "src/App.tsx", purpose: "Update the heading" }] })));
    const planned = await planApplication({ prompt: "Change the heading", files: [{ path: "src/App.tsx", content: "export default function App(){return <h1>Calculator</h1>}" }], mode: "edit" });
    expect(planned.manifest.files.map(file => file.path)).toEqual(["src/App.tsx"]);
  });

  it("reuses the approved plan without paying for another planning request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const manifest = { plan: { summary: "Minimal page", steps: ["Responsive page"] }, message: "Ready", files: ["package.json", "index.html", "src/main.tsx", "src/App.tsx", "src/index.css"].map(path => ({ path, purpose: path })) };
    const source = `export default function App(){return <main>${Array.from({ length: 12 }, (_, i) => `<section className="card"><h2>Section ${i}</h2><p>Useful content about this application.</p></section>`).join("")}</main>}`;
    const fetchMock = vi.fn(async () => reply({ files: [{ path: "package.json", content: JSON.stringify({ scripts: { build: "vite build" }, dependencies: { react: "latest", "react-dom": "latest", vite: "latest", "@vitejs/plugin-react": "latest" } }) }, { path: "index.html", content: '<div id="root"></div>' }, { path: "src/App.tsx", content: source }, { path: "src/index.css", content: "body{margin:0}.card{padding:2rem}".repeat(20) }] }));
    vi.stubGlobal("fetch", fetchMock);
    const output = await generateWithOpenRouter({ prompt: "Build a minimal page", files: [], mode: "create", approvedManifest: manifest });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output.result.plan).toEqual(manifest.plan);
  });

  it("stops before file generation when the INR build budget is exceeded", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.stubEnv("OPENROUTER_MAX_COST_INR_PER_BUILD", "10");
    const manifest = {
      plan: { summary: "Plan", steps: ["Build"] }, message: "Ready",
      files: [
        { path: "package.json", purpose: "Dependencies" }, { path: "index.html", purpose: "Document" },
        { path: "src/main.tsx", purpose: "Entry" }, { path: "src/App.tsx", purpose: "UI" },
        { path: "src/index.css", purpose: "Styles" },
      ],
    };
    const fetchMock = vi.fn(async () => reply(manifest, 1));
    vi.stubGlobal("fetch", fetchMock);
    const paidCalls: unknown[] = [];
    await expect(generateWithOpenRouter({ prompt: "Build an app", files: [], mode: "create", onUsage: async (event) => { paidCalls.push(event); } })).rejects.toThrow("₹10");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(paidCalls).toHaveLength(1);
  });
});

describe("generated stylesheet normalization", () => {
  it("replaces undefined semantic Tailwind utilities inside apply rules", () => {
    const file = normalizeGeneratedFile({
      path: "src/index.css",
      content: "body { @apply bg-background text-foreground; } .card { @apply border-border bg-card; }",
    });
    expect(file.content).toBe("body { @apply bg-white text-slate-900; } .card { @apply border-slate-200 bg-white; }");
  });
});

describe("generated dependency validation", () => {
  it("detects the missing calculator helper before sandbox installation", () => {
    expect(() => validateLocalImports([{ path: "src/components/Button.tsx", content: 'import { cn } from "../utils/cn"; export const Button = () => <button className={cn("btn")} />;' }])).toThrow("src/components/Button.tsx imports ../utils/cn");
    expect(() => validateLocalImports([{ path: "src/components/Button.tsx", content: 'import { cn } from "../utils/cn";' }, { path: "src/utils/cn.ts", content: 'export const cn = (...args: string[]) => args.join(" ");' }])).not.toThrow();
  });
  it("accepts Node built-ins and configured source aliases", () => {
    const files = [
      { path: "package.json", content: JSON.stringify({ dependencies: { react: "latest" } }) },
      { path: "tsconfig.json", content: JSON.stringify({ compilerOptions: { paths: { "@components/*": ["src/components/*"], "@hooks/*": ["src/hooks/*"] } } }) },
      { path: "vite.config.ts", content: 'import path from "path"; export default { resolve: { alias: { "@utils": path.resolve("src/utils") } } };' },
      { path: "src/App.tsx", content: 'import Header from "@components/Header"; import useCalc from "@hooks/useCalc"; import { sum } from "@utils/math"; export default function App(){return <Header>{sum(useCalc())}</Header>}' },
    ];
    expect(() => validateCreateDependencies(files)).not.toThrow();
  });

  it("still rejects undeclared external packages", () => {
    const files = [
      { path: "package.json", content: JSON.stringify({ dependencies: { react: "latest" } }) },
      { path: "src/App.tsx", content: 'import { motion } from "framer-motion"; export default function App(){return <motion.main />}' },
    ];
    expect(() => validateCreateDependencies(files)).toThrow("framer-motion");
  });
});
