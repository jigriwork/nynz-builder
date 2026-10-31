import { Sandbox } from "@e2b/code-interpreter";
import { filesAreSafe } from "./security";

const STARTER: Record<string, string> = {
  "package.json": JSON.stringify({ name: "nynz-app", private: true, version: "0.1.0", type: "module", scripts: { dev: "vite --host 0.0.0.0", build: "tsc -b && vite build" }, dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", typescript: "latest", react: "latest", "react-dom": "latest" }, devDependencies: { "@types/react": "latest", "@types/react-dom": "latest" } }, null, 2),
  "index.html": '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  "src/main.tsx": 'import React from "react";import{createRoot}from"react-dom/client";import App from"./App";import"./index.css";createRoot(document.getElementById("root")!).render(<App/>);',
  "src/App.tsx": 'export default function App(){return <main><h1>NYNZ preview</h1></main>}',
  "src/index.css": 'body{margin:0;font-family:Inter,system-ui,sans-serif}',
};

export async function runInE2B(input: Array<{ path: string; content: string }>, generatedBackend?: { projectUrl: string; publishableKey: string }) {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  const timeoutMs = Math.min(Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 600000), 3_600_000);
  const sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY, timeoutMs });
  const files = filesAreSafe(input);
  const merged = new Map(Object.entries(STARTER));
  files.forEach((file) => merged.set(file.path, file.content));
  await Promise.all([...merged].map(([path, content]) => sandbox.files.write(`/home/user/app/${path}`, content)));
  if (generatedBackend) await sandbox.files.write("/home/user/app/.env.local", `VITE_SUPABASE_URL=${generatedBackend.projectUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${generatedBackend.publishableKey}\n`);
  const install = await sandbox.commands.run("npm install --no-audit --no-fund", { cwd: "/home/user/app", timeoutMs: 180_000 });
  if (install.exitCode !== 0) { await sandbox.kill(); throw new Error(`Dependency install failed: ${install.stderr.slice(-2000)}`); }
  const build = await sandbox.commands.run("npm run build", { cwd: "/home/user/app", timeoutMs: 120_000 });
  if (build.exitCode !== 0) { await sandbox.kill(); throw new Error(`Build failed: ${build.stderr.slice(-3000)}`); }
  await sandbox.commands.run("npm run dev -- --port 5173", { cwd: "/home/user/app", background: true });
  return { sandboxId: sandbox.sandboxId, previewUrl: `https://${sandbox.getHost(5173)}`, expiresAt: new Date(Date.now() + timeoutMs).toISOString(), logs: `${install.stdout}\n${build.stdout}`.slice(-10_000) };
}

export async function stopE2B(sandboxId: string) {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
  return Sandbox.kill(sandboxId, { apiKey: process.env.E2B_API_KEY });
}
