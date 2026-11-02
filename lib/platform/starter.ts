/** Tested infrastructure files shared by planning, generation and preview. */
export const APP_STARTER: Record<string, string> = {
  "package.json": JSON.stringify({ name: "nynz-app", private: true, version: "1.0.0", type: "module", scripts: { dev: "vite --host 0.0.0.0", build: "tsc --noEmit && vite build" }, dependencies: { react: "^19.1.0", "react-dom": "^19.1.0", "lucide-react": "^0.532.0", clsx: "^2.1.1" }, devDependencies: { vite: "^6.1.0", "@vitejs/plugin-react": "^4.4.1", typescript: "^5.8.3", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@types/node": "^22.0.0" } }, null, 2),
  "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, resolveJsonModule: true, isolatedModules: true, noEmit: true }, include: ["src"] }, null, 2),
  "vite.config.ts": 'import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({ plugins: [react()] });',
  "src/vite-env.d.ts": '/// <reference types="vite/client" />',
  "src/main.tsx": 'import { createRoot } from "react-dom/client"; import App from "./App"; import "./index.css"; createRoot(document.getElementById("root")!).render(<App />);',
  "index.html": '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Application</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
};

export const FIXED_STARTER_PATHS = new Set(["tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "vite.config.ts", "src/vite-env.d.ts", "src/main.tsx"]);
