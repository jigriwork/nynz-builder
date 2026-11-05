import { describe, expect, it } from "vitest";
import { briefContext, deterministicCoverage, estimateBuildCredits, estimateOutputTokens, groupForEdit, pathsInMessage, planBatches, salvageFiles, splitBatch } from "../../lib/platform/build-engine";

// The StudioMark manifest that failed in production on 2026-11-04: batch 4
// asked for four full screens in one 12,000-token response.
const STUDIOMARK = [
  ["package.json", "Dependencies"], ["index.html", "Document"], ["src/App.tsx", "Routing and shell"], ["src/index.css", "Responsive styles"],
  ["src/types.ts", "Types"], ["src/seed.ts", "20+ fictional products, customers and orders (seed data)"], ["src/store.tsx", "localStorage store"], ["src/utils.ts", "Formatting helpers"],
  ["src/pages/Landing.tsx", "Landing page"], ["src/pages/DemoLogin.tsx", "Demo access"], ["src/pages/Workspace.tsx", "Workspace shell"], ["src/pages/Dashboard.tsx", "Dashboard with charts"],
  ["src/pages/Products.tsx", "Products CRUD with variants"], ["src/pages/Customers.tsx", "Customers CRUD"], ["src/pages/Orders.tsx", "Orders"], ["src/pages/Reports.tsx", "Reports"],
].map(([path, purpose]) => ({ path, purpose }));

describe("batch sizing", () => {
  it("never puts four large screens in one request", () => {
    const batches = planBatches(STUDIOMARK, 16_000);
    for (const batch of batches) {
      const expected = batch.reduce((sum, file) => sum + estimateOutputTokens(file), 0);
      expect(expected).toBeLessThanOrEqual(9_600);
    }
    const late = batches.find((batch) => batch.some((file) => file.path.endsWith("Orders.tsx")))!;
    expect(late.filter((file) => /pages\//.test(file.path)).length).toBeLessThanOrEqual(2);
    expect(batches.flat().map((file) => file.path)).toEqual(STUDIOMARK.map((file) => file.path));
  });

  it("splits a failed batch into two smaller ones", () => {
    expect(splitBatch([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(splitBatch([1])).toEqual([[1]]);
  });
});

describe("salvaging a cut-off response", () => {
  it("keeps only the files the model finished", () => {
    const full = JSON.stringify({ files: [
      { path: "src/pages/Products.tsx", content: 'export default function Products(){return <h1>{"Products {braces}"}</h1>}' },
      { path: "src/pages/Customers.tsx", content: "export default function Customers(){return <h1>Customers \\\"quoted\\\"</h1>}" },
      { path: "src/pages/Orders.tsx", content: "export default function Orders(){return <h1>Orders</h1>}" },
    ] });
    const cut = full.slice(0, full.indexOf("Orders</h1>"));
    const salvaged = salvageFiles(cut);
    expect(salvaged.map((file) => file.path)).toEqual(["src/pages/Products.tsx", "src/pages/Customers.tsx"]);
    expect(salvaged[0].content).toContain("{braces}");
  });

  it("returns nothing for garbage", () => {
    expect(salvageFiles("not json")).toEqual([]);
    expect(salvageFiles('{"files":[{"path":"a"')).toEqual([]);
  });
});

describe("credit estimate", () => {
  it("gives a range and a hold inside it, before approval", () => {
    const estimate = estimateBuildCredits({ files: STUDIOMARK, mode: "create", briefChars: 4_700, minimumHold: 20, env: {} });
    expect(estimate.low).toBeLessThan(estimate.high);
    expect(estimate.reserve).toBeGreaterThanOrEqual(20);
    expect(estimate.reserve).toBeLessThanOrEqual(estimate.high);
    // The production run of this brief consumed 28-45 credits for its file batches.
    expect(estimate.low).toBeLessThanOrEqual(45);
    expect(estimate.high).toBeGreaterThanOrEqual(45);
  });
});

describe("project brief", () => {
  it("carries the original requirements and applied changes into follow-ups", () => {
    const text = briefContext({ original: "Build StudioMark with demo login, products with variants and reports.", plan: { summary: "StudioMark", steps: ["Landing", "Reports"] }, changes: [{ build_id: "b1", request: "Add a dark theme", summary: "Dark theme", status: "applied" }, { build_id: "b2", request: "Pending", status: "approved" }] }, "b3");
    expect(text).toContain("products with variants and reports");
    expect(text).toContain("1. Landing");
    expect(text).toContain("Dark theme");
    expect(text).not.toContain("Pending");
    expect(briefContext(null)).toBe("");
  });
});

describe("coverage and targeting", () => {
  it("reports planned files that are missing and existing files that were dropped", () => {
    const result = deterministicCoverage({ planned: ["src/App.tsx", "src/pages/Reports.tsx"], files: [{ path: "src/App.tsx", content: "x" }], previous: ["src/App.tsx", "src/pages/Orders.tsx"] });
    expect(result.missingFiles).toEqual(["src/pages/Reports.tsx"]);
    expect(result.removedFiles).toEqual(["src/pages/Orders.tsx"]);
  });

  it("finds the files a compiler error names", () => {
    const files = [{ path: "src/pages/Orders.tsx", content: "" }, { path: "src/App.tsx", content: "" }];
    expect(pathsInMessage("src/pages/Orders.tsx(12,5): error TS2304: Cannot find name 'x'.", files)).toEqual(["src/pages/Orders.tsx"]);
  });

  it("groups edits so each request carries bounded source", () => {
    const sizes = new Map([["a", 20_000], ["b", 10_000], ["c", 3_000], ["d", 3_000]]);
    expect(groupForEdit(["a", "b", "c", "d"], sizes)).toEqual([["a"], ["b", "c", "d"]]);
  });
});
