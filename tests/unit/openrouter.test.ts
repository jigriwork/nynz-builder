import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWithOpenRouter } from "../../lib/platform/openrouter";
import { normalizeGeneratedFile } from "../../lib/platform/sarvam";

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
    const appSections = Array.from({ length: 45 }, (_, index) => `<section className="card card-${index}"><h2>Collection ${index}</h2><p>Thoughtfully written product information for a complete shopping experience.</p><button type="button">Explore</button></section>`).join("");
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
    const responses = [reply(manifest), ...batches.map((batch) => reply(batch))];
    const fetchMock = vi.fn(async () => responses.shift() || reply({ files: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const paidCalls: unknown[] = [];
    const output = await generateWithOpenRouter({ prompt: "Build a polished store", files: [], mode: "create", onUsage: async (event) => { paidCalls.push(event); } });
    expect(output.result.files).toHaveLength(8);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(paidCalls).toHaveLength(3);
    expect(output.usage.costUsd).toBeCloseTo(0.03);
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
