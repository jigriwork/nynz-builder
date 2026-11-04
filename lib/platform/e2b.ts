import { Sandbox } from "@e2b/code-interpreter";
import { CommandExitError } from "e2b";
import { filesAreSafe } from "./security";
import { APP_STARTER } from "./starter";

const STARTER: Record<string, string> = {
  "package.json": JSON.stringify({ name: "nynz-app", private: true, version: "0.1.0", type: "module", scripts: { dev: "vite --host 0.0.0.0", build: "tsc -b && vite build", preview: "vite preview" }, dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", typescript: "latest", react: "latest", "react-dom": "latest" }, devDependencies: { "@types/node": "latest", "@types/react": "latest", "@types/react-dom": "latest" } }, null, 2),
  "index.html": '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  "vite.config.ts": 'import{defineConfig}from"vite";import react from"@vitejs/plugin-react";export default defineConfig({plugins:[react()]});',
  "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }] }, null, 2),
  "tsconfig.app.json": JSON.stringify({ compilerOptions: { target: "ES2022", useDefineForClassFields: true, lib: ["ES2022", "DOM", "DOM.Iterable"], allowJs: false, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, strict: true, forceConsistentCasingInFileNames: true, module: "ESNext", moduleResolution: "Bundler", resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: "react-jsx" }, include: ["src"] }, null, 2),
  "tsconfig.node.json": JSON.stringify({ compilerOptions: { composite: true, skipLibCheck: true, module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true }, include: ["vite.config.ts"] }, null, 2),
  "src/vite-env.d.ts": '/// <reference types="vite/client" />',
  "src/main.tsx": 'import{createRoot}from"react-dom/client";import App from"./App";import"./index.css";createRoot(document.getElementById("root")!).render(<App/>);',
  "src/App.tsx": 'export default function App(){return <main><h1>NYNZ preview</h1></main>}',
  "src/index.css": 'body{margin:0;font-family:Inter,system-ui,sans-serif}',
  ...APP_STARTER,
};

const PREVIEW_LAUNCHER = `import { loadConfigFromFile, mergeConfig, preview } from "vite";
const allowedHost = process.env.NYNZ_PREVIEW_HOST;
if (!allowedHost) throw new Error("NYNZ_PREVIEW_HOST is required");
const loaded = await loadConfigFromFile({ command: "serve", mode: "production" }, undefined, process.cwd());
const config = mergeConfig(loaded?.config || {}, { configFile: false, preview: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: [allowedHost] } });
const server = await preview(config);
server.printUrls();
`;

async function runRequiredCommand(sandbox: Sandbox, command: string, options: { cwd: string; timeoutMs: number }, label: string) {
  try {
    return await sandbox.commands.run(command, options);
  } catch (error) {
    if (error instanceof CommandExitError) {
      const detail = `${error.stderr || ""}\n${error.stdout || ""}`.trim().slice(-3_000);
      throw new Error(`${label} failed${detail ? `: ${detail}` : ` with exit code ${error.exitCode}`}`);
    }
    throw error;
  }
}

type PreviewBuildOptions = {
  signal?: AbortSignal;
  /** Authorise the full bounded runtime before allocating a paid sandbox. */
  beforeCreate?: (seconds: number) => Promise<void>;
  onBuildFailure?: (error: string, files: Array<{ path: string; content: string }>, attempt: number) => Promise<Array<{ path: string; content: string }>>;
  onStage?: (message: string, percent: number) => Promise<void>;
  /** Called as soon as the sandbox exists, before any file is written, so it is registered for cleanup even if the build fails. */
  onCreated?: (sandboxId: string) => Promise<void>;
  /** Bound into sandbox metadata; the terminal and reconciler verify it. */
  owner?: { projectId: string; buildId: string };
};

export const SANDBOX_PURPOSE = "nynz-generated-preview";

export function sandboxTimeoutMs(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.E2B_SANDBOX_TIMEOUT_MS || 600000);
  if (!Number.isFinite(value) || value < 60_000) throw new Error("E2B_SANDBOX_TIMEOUT_MS must be at least 60000");
  return Math.min(Math.floor(value), 3_600_000);
}

// Disable package lifecycle hooks, including when a generated .npmrc tries to
// opt back in. Explicit build scripts still run inside the isolated sandbox.
export const INSTALL_COMMAND = "npm install --ignore-scripts --no-audit --no-fund";

function terminateOnAbort(sandbox: Sandbox, signal?: AbortSignal) {
  const abort = () => { void sandbox.kill().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return () => signal?.removeEventListener("abort", abort);
}

export async function runInE2B(input: Array<{ path: string; content: string }>, generatedBackend?: { projectUrl: string; publishableKey: string }, assets: Array<{ name: string; data: ArrayBuffer }> = [], options: PreviewBuildOptions = {}) {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  const timeoutMs = sandboxTimeoutMs();
  options.signal?.throwIfAborted();
  await options.beforeCreate?.(Math.ceil(timeoutMs / 1000));
  options.signal?.throwIfAborted();
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    timeoutMs,
    lifecycle: { onTimeout: { action: "pause", mode: "full" }, autoResume: true },
    network: { allowPublicTraffic: false },
    metadata: { purpose: SANDBOX_PURPOSE, ...(options.owner ? { projectId: options.owner.projectId, buildId: options.owner.buildId } : {}) },
  });
  const removeAbortListener = terminateOnAbort(sandbox, options.signal);
  try {
    options.signal?.throwIfAborted();
    await options.onCreated?.(sandbox.sandboxId);
    const files = filesAreSafe(input);
    const merged = new Map(Object.entries(STARTER));
    files.forEach((file) => merged.set(file.path, file.content));
    const starterPackageJson = JSON.parse(STARTER["package.json"]);
    const packageJson = JSON.parse(merged.get("package.json") || STARTER["package.json"]);
    packageJson.dependencies = { ...starterPackageJson.dependencies, ...packageJson.dependencies };
    packageJson.devDependencies = { ...starterPackageJson.devDependencies, ...packageJson.devDependencies };
    packageJson.scripts = { ...packageJson.scripts, build: packageJson.scripts?.build || "vite build", preview: "node .nynz-preview.mjs" };
    merged.set("package.json", JSON.stringify(packageJson, null, 2));
    merged.set(".nynz-preview.mjs", PREVIEW_LAUNCHER);
    // E2B creates parent directories on write. Writing sibling paths in the
    // same new directory concurrently can race, so assemble the project in a
    // deterministic sequence before installation.
    for (const [path, content] of merged) await sandbox.files.write(`/home/user/app/${path}`, content);
    for (const asset of assets) await sandbox.files.write(`/home/user/app/public/uploads/${asset.name}`, asset.data);
    if (generatedBackend) await sandbox.files.write("/home/user/app/.env.local", `VITE_SUPABASE_URL=${generatedBackend.projectUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${generatedBackend.publishableKey}\n`);
    await options.onStage?.("Installing application dependencies", 70);
    const install = await runRequiredCommand(sandbox, INSTALL_COMMAND, { cwd: "/home/user/app", timeoutMs: 180_000 }, "Dependency install");
    let build: Awaited<ReturnType<typeof runRequiredCommand>> | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await options.onStage?.(attempt === 1 ? "Compiling and typechecking the application" : "Rechecking the repaired application", 80);
      try {
        build = await runRequiredCommand(sandbox, "npm run build", { cwd: "/home/user/app", timeoutMs: 120_000 }, "Production build");
        break;
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!options.onBuildFailure || attempt === 3 || !(error instanceof Error) || !error.message.startsWith("Production build failed")) throw error;
        const repaired = filesAreSafe(await options.onBuildFailure(error.message, [...merged].filter(([path]) => path !== ".nynz-preview.mjs").map(([path, content]) => ({ path, content })), attempt));
        let dependenciesChanged = false;
        for (const file of repaired) {
          if (file.path === ".nynz-preview.mjs" || merged.get(file.path) === file.content) continue;
          if (file.path === "package.json") dependenciesChanged = true;
          merged.set(file.path, file.content);
          await sandbox.files.write(`/home/user/app/${file.path}`, file.content);
        }
        if (dependenciesChanged) await runRequiredCommand(sandbox, INSTALL_COMMAND, { cwd: "/home/user/app", timeoutMs: 180_000 }, "Dependency install");
      }
    }
    if (!build) throw new Error("Production build did not complete");
    await options.onStage?.("Starting the secure application preview", 90);
    const previewHost = sandbox.getHost(5173);
    await sandbox.commands.run(`NYNZ_PREVIEW_HOST=${previewHost} npm run preview`, { cwd: "/home/user/app", background: true });

    const previewUrl = `https://${previewHost}`;
    if (!sandbox.trafficAccessToken) throw new Error("E2B private traffic token was not returned");
    let authenticatedStatus = 0;
    let authenticatedDetail = "";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      options.signal?.throwIfAborted();
      try {
        const internal = await sandbox.commands.run("node -e \"fetch('http://127.0.0.1:5173/').then(async r=>{if(!r.ok)process.exit(1);console.log((await r.text()).slice(0,40))})\"", { cwd: "/home/user/app", timeoutMs: 10_000 });
        const listening = await sandbox.commands.run("ss -ltn | grep -E '0\\.0\\.0\\.0:5173|\\*:5173'", { timeoutMs: 10_000 });
        if (internal.exitCode !== 0 || listening.exitCode !== 0) throw new Error("Preview is not listening on 0.0.0.0:5173");
        const denied = await fetch(previewUrl, { redirect: "manual", signal: AbortSignal.timeout(4_000) });
        if (denied.status !== 403) throw new Error(`Private E2B preview unexpectedly returned HTTP ${denied.status} without traffic authentication`);
        const authenticated = await fetch(previewUrl, { headers: { "e2b-traffic-access-token": sandbox.trafficAccessToken }, signal: AbortSignal.timeout(4_000) });
        authenticatedStatus = authenticated.status;
        const previewHtml = await authenticated.text();
        authenticatedDetail = previewHtml.replace(/\s+/g, " ").slice(0, 240);
        if (authenticated.ok && /<html|<div|<main/i.test(previewHtml)) {
          return { sandboxId: sandbox.sandboxId, expiresAt: null, logs: `${install.stdout}\n${build.stdout}`.slice(-10_000) };
        }
      } catch {
        options.signal?.throwIfAborted();
        // The production preview can take a few seconds to begin accepting traffic.
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error(`Authenticated E2B preview was not reachable${authenticatedStatus ? ` (HTTP ${authenticatedStatus}${authenticatedDetail ? `: ${authenticatedDetail}` : ""})` : ""}`);
  } catch (error) {
    await sandbox.kill().catch(() => undefined);
    options.signal?.throwIfAborted();
    throw error;
  } finally { removeAbortListener(); }
}

/** Idempotent: resolves true when the sandbox is gone (including "already gone"). */
export async function stopE2B(sandboxId: string) {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  await Sandbox.kill(sandboxId, { apiKey: process.env.E2B_API_KEY });
  return true;
}

/** Lists every NYNZ-created sandbox (running or paused) for orphan reconciliation. */
export async function listNynzSandboxes() {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  const paginator = Sandbox.list({ apiKey: process.env.E2B_API_KEY, query: { metadata: { purpose: SANDBOX_PURPOSE } } });
  const out: Array<{ sandboxId: string; startedAt: Date; metadata: Record<string, string> }> = [];
  while (paginator.hasNext && out.length < 5_000) {
    for (const item of await paginator.nextItems()) out.push({ sandboxId: item.sandboxId, startedAt: new Date(item.startedAt), metadata: item.metadata || {} });
  }
  return out;
}


/**
 * Builds the project's production bundle in a fresh isolated sandbox and
 * returns the files under dist/. Nothing from the customer's app runs on the
 * platform host; the sandbox is always killed afterwards.
 */
export async function buildArtifactInE2B(input: Array<{ path: string; content: string }>, generatedBackend: { projectUrl: string; publishableKey: string } | undefined, assets: Array<{ name: string; data: ArrayBuffer }>, options: { owner: { projectId: string; buildId: string }; onCreated?: (sandboxId: string) => Promise<void>; beforeCreate?: (seconds: number) => Promise<void>; signal?: AbortSignal; maxFiles: number; maxBytes: number }) {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  options.signal?.throwIfAborted();
  await options.beforeCreate?.(600);
  options.signal?.throwIfAborted();
  const sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY, timeoutMs: 600_000, network: { allowPublicTraffic: false }, metadata: { purpose: SANDBOX_PURPOSE, projectId: options.owner.projectId, buildId: options.owner.buildId } });
  const removeAbortListener = terminateOnAbort(sandbox, options.signal);
  try {
    await options.onCreated?.(sandbox.sandboxId);
    const files = filesAreSafe(input);
    const merged = new Map(Object.entries(STARTER));
    files.forEach((file) => merged.set(file.path, file.content));
    const starterPackageJson = JSON.parse(STARTER["package.json"]);
    const packageJson = JSON.parse(merged.get("package.json") || STARTER["package.json"]);
    packageJson.dependencies = { ...starterPackageJson.dependencies, ...packageJson.dependencies };
    packageJson.devDependencies = { ...starterPackageJson.devDependencies, ...packageJson.devDependencies };
    packageJson.scripts = { ...packageJson.scripts, build: packageJson.scripts?.build || "vite build" };
    merged.set("package.json", JSON.stringify(packageJson, null, 2));
    for (const [path, content] of merged) await sandbox.files.write(`/home/user/app/${path}`, content);
    for (const asset of assets) await sandbox.files.write(`/home/user/app/public/uploads/${asset.name}`, asset.data);
    if (generatedBackend) await sandbox.files.write("/home/user/app/.env.production.local", `VITE_SUPABASE_URL=${generatedBackend.projectUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${generatedBackend.publishableKey}\n`);
    await runRequiredCommand(sandbox, INSTALL_COMMAND, { cwd: "/home/user/app", timeoutMs: 180_000 }, "Dependency install");
    await runRequiredCommand(sandbox, "npm run build", { cwd: "/home/user/app", timeoutMs: 180_000 }, "Production build");
    const listing = await runRequiredCommand(sandbox, "cd dist && find . -type f -printf '%s %P\\n'", { cwd: "/home/user/app", timeoutMs: 30_000 }, "Artifact listing");
    const entries = listing.stdout.split("\n").filter(Boolean).map((line) => { const [size, ...rest] = line.split(" "); return { size: Number(size), path: rest.join(" ") }; });
    if (entries.length > options.maxFiles || entries.reduce((sum, entry) => sum + entry.size, 0) > options.maxBytes) throw new Error("Build output exceeds publishing limits");
    const out: Array<{ path: string; data: Uint8Array }> = [];
    for (const entry of entries) out.push({ path: entry.path, data: await sandbox.files.read(`/home/user/app/dist/${entry.path}`, { format: "bytes" }) });
    return { sandboxId: sandbox.sandboxId, files: out };
  } finally {
    removeAbortListener();
    await sandbox.kill().catch(() => undefined);
  }
}
