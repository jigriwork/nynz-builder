import { Sandbox } from "@e2b/code-interpreter";
import { CommandExitError } from "e2b";
import { filesAreSafe } from "./security";

const STARTER: Record<string, string> = {
  "package.json": JSON.stringify({ name: "nynz-app", private: true, version: "0.1.0", type: "module", scripts: { dev: "vite --host 0.0.0.0", build: "tsc -b && vite build", preview: "vite preview" }, dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", typescript: "latest", react: "latest", "react-dom": "latest" }, devDependencies: { "@types/react": "latest", "@types/react-dom": "latest" } }, null, 2),
  "index.html": '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  "src/main.tsx": 'import React from "react";import{createRoot}from"react-dom/client";import App from"./App";import"./index.css";createRoot(document.getElementById("root")!).render(<App/>);',
  "src/App.tsx": 'export default function App(){return <main><h1>NYNZ preview</h1></main>}',
  "src/index.css": 'body{margin:0;font-family:Inter,system-ui,sans-serif}',
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

export async function runInE2B(input: Array<{ path: string; content: string }>, generatedBackend?: { projectUrl: string; publishableKey: string }) {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  const timeoutMs = Math.min(Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 600000), 3_600_000);
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    timeoutMs,
    network: { allowPublicTraffic: false },
    metadata: { purpose: "nynz-generated-preview" },
  });
  try {
    const files = filesAreSafe(input);
    const merged = new Map(Object.entries(STARTER));
    files.forEach((file) => merged.set(file.path, file.content));
    const packageJson = JSON.parse(merged.get("package.json") || STARTER["package.json"]);
    packageJson.scripts = { ...packageJson.scripts, build: packageJson.scripts?.build || "vite build", preview: "node .nynz-preview.mjs" };
    merged.set("package.json", JSON.stringify(packageJson, null, 2));
    merged.set(".nynz-preview.mjs", PREVIEW_LAUNCHER);
    await Promise.all([...merged].map(([path, content]) => sandbox.files.write(`/home/user/app/${path}`, content)));
    if (generatedBackend) await sandbox.files.write("/home/user/app/.env.local", `VITE_SUPABASE_URL=${generatedBackend.projectUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${generatedBackend.publishableKey}\n`);
    const install = await runRequiredCommand(sandbox, "npm install --no-audit --no-fund", { cwd: "/home/user/app", timeoutMs: 180_000 }, "Dependency install");
    const build = await runRequiredCommand(sandbox, "npm run build", { cwd: "/home/user/app", timeoutMs: 120_000 }, "Production build");
    const previewHost = sandbox.getHost(5173);
    await sandbox.commands.run(`NYNZ_PREVIEW_HOST=${previewHost} npm run preview`, { cwd: "/home/user/app", background: true });

    const previewUrl = `https://${previewHost}`;
    if (!sandbox.trafficAccessToken) throw new Error("E2B private traffic token was not returned");
    let authenticatedStatus = 0;
    let authenticatedDetail = "";
    for (let attempt = 0; attempt < 12; attempt += 1) {
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
          return { sandboxId: sandbox.sandboxId, expiresAt: new Date(Date.now() + timeoutMs).toISOString(), logs: `${install.stdout}\n${build.stdout}`.slice(-10_000) };
        }
      } catch {
        // The production preview can take a few seconds to begin accepting traffic.
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error(`Authenticated E2B preview was not reachable${authenticatedStatus ? ` (HTTP ${authenticatedStatus}${authenticatedDetail ? `: ${authenticatedDetail}` : ""})` : ""}`);
  } catch (error) {
    await sandbox.kill().catch(() => undefined);
    throw error;
  }
}

export async function stopE2B(sandboxId: string) {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  return Sandbox.kill(sandboxId, { apiKey: process.env.E2B_API_KEY });
}
