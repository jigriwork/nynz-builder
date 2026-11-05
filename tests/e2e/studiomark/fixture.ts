/**
 * A frontend-only, StudioMark-style app used by the local recovery proof. Its
 * shape matches the production StudioMark build (16 files, eight screens,
 * localStorage data), and the brief carries the same kinds of requirements.
 * No customer data is used; everything here is fictional.
 */
export const BRIEF = `Build "StudioMark": a premium fashion retail management web app (FRONTEND ONLY). Use fictional data and browser localStorage persistence.
PUBLIC LANDING PAGE: strong hero, calls to action, working mobile hamburger menu, "Explore demo" opens the demo-login screen.
DEMO ACCESS: Manager and Staff demo accounts with visible credentials and a role switcher. Staff can create orders and view products; Manager can edit inventory and view reports.
WORKSPACE: responsive sidebar; dashboard with sales, orders, units sold and low-stock counts derived from records.
PRODUCTS with size and colour variant stock; CUSTOMERS; ORDERS; REPORTS with sales by category.`;

export const PLAN = {
  summary: "StudioMark: a premium retail workspace with a landing page, demo access, dashboard, products, customers, orders and reports.",
  steps: [
    "Landing page with hero, calls to action and a working hamburger menu",
    "Demo access with Manager and Staff accounts and a role switcher",
    "Workspace shell and dashboard with live counts",
    "Products with size and colour variants, customers and orders",
    "Reports with sales by category",
  ],
};

export const SCREENS = ["Landing", "DemoLogin", "Workspace", "Dashboard", "Products", "Customers", "Orders", "Reports"];

export const MANIFEST = {
  plan: PLAN,
  // Production planners phrase this as a proposal; it must never be the completion reply.
  message: "Here is the proposed plan for StudioMark. Please review it and let me know if you'd like any changes before I write code.",
  files: [
    ["package.json", "Dependencies"], ["index.html", "Document with StudioMark title"], ["src/main.tsx", "Entry"], ["src/App.tsx", "Routing between screens"],
    ["src/index.css", "Responsive premium styles"], ["src/types.ts", "Product, customer and order types"], ["src/seed.ts", "Fictional seed data"], ["src/store.tsx", "localStorage store"],
    ...SCREENS.map((name) => [`src/pages/${name}.tsx`, `${name} screen`]),
  ].map(([path, purpose]) => ({ path, purpose })),
};

/** A small two-screen app for the new-customer journey (comparable to Saffron Loom). */
export const SMALL_SCREENS = ["Landing", "Orders"];
export const SMALL_MANIFEST = {
  plan: { summary: "Saffron Loom: a small boutique orders app with a landing page and an orders workspace.", steps: ["Landing page with navigation and a hero", "Orders workspace with a grid of order cards"] },
  message: "Here is the proposed plan for Saffron Loom. Please review it before I write code.",
  files: [
    ["package.json", "Dependencies"], ["index.html", "Document"], ["src/main.tsx", "Entry"], ["src/App.tsx", "Routing"], ["src/index.css", "Styles"],
    ["src/types.ts", "Types"], ["src/seed.ts", "Seed data"], ["src/store.tsx", "Store"], ["src/pages/Landing.tsx", "Landing"], ["src/pages/Orders.tsx", "Orders"],
  ].map(([path, purpose]) => ({ path, purpose })),
};

/** Follow-up edit: add a dark theme; touches App and styles only. */
export const EDIT_REQUEST = "Add a dark theme toggle to the workspace header.";
export const EDIT_MANIFEST = {
  plan: { summary: "Add a dark theme toggle", steps: ["Add a dark theme toggle to the workspace header and dark styles"] },
  message: "Here is the proposed change: a dark theme toggle in the workspace header. Please review it before I write code.",
  files: [{ path: "src/App.tsx", purpose: "Add the theme toggle" }, { path: "src/index.css", purpose: "Dark theme styles" }],
};

function page(name: string) {
  const rows = Array.from({ length: 8 }, (_, i) => `<article className="card ${name.toLowerCase()}-row-${i}"><h2>${name} record ${i + 1}</h2><p>Fictional demonstration data for the ${name} screen of StudioMark.</p><button type="button" className="btn">Open</button></article>`).join("");
  return `import { useStore } from "../store";\n\nexport default function ${name}() {\n  const store = useStore();\n  return <section className="page page-${name.toLowerCase()}" aria-label="${name}"><h1>${name}</h1><p className="meta">{store.products.length} products in the catalogue</p>${rows}</section>;\n}\n`;
}

export function fileContent(path: string, screens: string[] = SCREENS): string {
  switch (path) {
    case "package.json": return JSON.stringify({ name: "studiomark", private: true, type: "module", scripts: { dev: "vite", build: "tsc --noEmit && vite build" }, dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" }, devDependencies: { vite: "^6.1.0", "@vitejs/plugin-react": "^4.4.1", typescript: "^5.8.3", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" } }, null, 2);
    case "index.html": return '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>StudioMark</title><meta name="description" content="StudioMark retail workspace demo"/></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
    case "src/App.tsx": return `${screens.map((name) => `import ${name} from "./pages/${name}";`).join("\n")}\n\nexport default function App() {\n  return <main className="app"><header className="topbar"><strong>StudioMark</strong></header>${screens.map((name) => `<${name} />`).join("")}</main>;\n}\n`;
    case "src/index.css": return `*{box-sizing:border-box}body{margin:0;font-family:Georgia,serif;background:#faf6ee;color:#1f1b3a}.app{min-height:100vh}.topbar{display:flex;gap:1rem;padding:1rem 2rem;background:#1f1b3a;color:#faf6ee}.page{padding:2rem}.card{padding:1rem;margin:.5rem 0;border:1px solid #e6dcc8;border-radius:12px;background:#fff}.btn{background:#f59e0b;border:0;padding:.5rem 1rem;border-radius:999px}.meta{color:#6b6280}${SCREENS.map((name) => `.page-${name.toLowerCase()}{display:grid;gap:1rem}${Array.from({ length: 8 }, (_, i) => `.${name.toLowerCase()}-row-${i}{order:${i}}`).join("")}`).join("")}@media(max-width:720px){.page{padding:1rem}.topbar{padding:1rem}}`;
    case "src/types.ts": return "export type Variant = { size: string; colour: string; stock: number };\nexport type Product = { id: string; name: string; category: string; price: number; variants: Variant[] };\nexport type Customer = { id: string; name: string; phone: string };\nexport type Order = { id: string; customerId: string; total: number };\n";
    case "src/seed.ts": return `import type { Product } from "./types";\n\nexport const seedProducts: Product[] = [${Array.from({ length: 20 }, (_, i) => `{ id: "p${i + 1}", name: "Kurta ${i + 1}", category: "${["Kurtas", "Sarees", "Denim", "Accessories"][i % 4]}", price: ${1499 + i * 100}, variants: [{ size: "M", colour: "Indigo", stock: ${i % 6} }] }`).join(",\n  ")}];\n`;
    case "src/store.tsx": return `import { seedProducts } from "./seed";\nimport type { Product } from "./types";\n\nexport function useStore(): { products: Product[] } {\n  try { const saved = localStorage.getItem("studiomark.products"); return { products: saved ? (JSON.parse(saved) as Product[]) : seedProducts }; }\n  catch { return { products: seedProducts }; }\n}\n`;
    default: {
      const name = path.match(/src\/pages\/(\w+)\.tsx$/)?.[1];
      if (name) return page(name);
      throw new Error(`No fixture content for ${path}`);
    }
  }
}
