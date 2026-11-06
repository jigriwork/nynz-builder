import { describe, expect, it } from "vitest";
import { filesFor, milestonesFor, verificationFor, type ActivityBuild } from "../../components/builder/build-activity";

// The real progress log of the Saffron Loom validation build (2026-11-05).
const at = (t: string) => `2026-11-05T${t}Z`;
const SAFFRON = [
  ["14:54:50", "Preparing project context"], ["14:54:50", "Planning the screens, design and functionality for your approval"], ["14:54:59", "Plan ready for your approval. No code generation has started."],
  ["14:55:36", "Plan approved. Application build queued."], ["14:55:38", "Preparing project context"], ["14:55:38", "Writing the approved application"],
  ["14:55:38", "Writing package.json, index.html, types.ts, data.ts"], ["14:55:52", "Saved package.json, index.html, types.ts, data.ts"], ["14:55:52", "Writing useOrders.ts, Landing.tsx"],
  ["14:56:08", "Saved useOrders.ts, Landing.tsx"], ["14:56:08", "Writing Workspace.tsx, App.tsx"], ["14:56:21", "Saved Workspace.tsx, App.tsx"], ["14:56:21", "Writing index.css"], ["14:56:41", "Saved index.css"],
  ["14:56:41", "Checking the result against the approved plan"], ["14:56:49", "Preparing a secure preview environment"], ["14:56:54", "Installing application dependencies"],
  ["14:57:09", "Compiling and typechecking the application"], ["14:57:14", "Starting the secure application preview"], ["14:57:17", "Validating production build and preview"], ["14:57:17", "Build complete"],
].map(([t, message]) => ({ at: at(t), message }));
const STEPS = ["Landing page", "Mobile menu", "Feature cards", "Orders workspace", "Order grid and filter", "New order form"];
const succeeded: ActivityBuild = { id: "b1", status: "succeeded", mode: "create", created_at: at("14:54:50"), progress: SAFFRON, plan: { steps: STEPS, coverage: { missing: [], unconfirmed: ["Orders grid 3+ columns wide"] } } };

describe("build milestones", () => {
  it("turns the real Saffron log into a few ordered milestones, one for all files", () => {
    const labels = milestonesFor(succeeded).map((m) => m.label);
    expect(labels).toEqual([
      "Plan approved, building started", "Wrote 9 files", "Reviewed the code against your plan", "Installed dependencies", "Compiled and type-checked", "Starting the preview", "Preview is live",
    ]);
    expect(filesFor(succeeded)).toEqual(["package.json", "index.html", "types.ts", "data.ts", "useOrders.ts", "Landing.tsx", "Workspace.tsx", "App.tsx", "index.css"]);
  });

  it("is stable: the same events give the same list, and repeated events never duplicate", () => {
    const doubled = { ...succeeded, progress: [...SAFFRON, ...SAFFRON.slice(-4)] };
    expect(milestonesFor(doubled).map((m) => m.key)).toEqual(milestonesFor(succeeded).map((m) => m.key));
  });

  it("explains repairs, a failure with saved work, a stop and a resume", () => {
    const failed: ActivityBuild = { id: "f", status: "failed", mode: "create", created_at: at("10:00:00"), error_code: "GENERATION_INCOMPLETE", resumable: true, checkpoint: { done: ["src/App.tsx", "src/a.ts", "src/b.ts"], failed_step: { label: "Writing Reports.tsx" } },
      progress: [{ at: at("10:00:01"), message: "Plan approved. Application build queued." }, { at: at("10:00:10"), message: "Saved App.tsx, a.ts, b.ts" }] };
    const last = milestonesFor(failed).at(-1)!;
    expect(last).toMatchObject({ tone: "bad", label: "One step couldn't be finished automatically" });
    expect(last.detail).toBe("Stopped at: Writing Reports.tsx. 3 finished files are saved; Resume continues from there.");
    const resumed: ActivityBuild = { id: "r", status: "succeeded", mode: "create", resume_of: "f", created_at: at("10:05:00"), progress: [
      { at: at("10:05:01"), message: "Continuing from 3 finished file(s); finished work is reused, not regenerated" }, { at: at("10:05:20"), message: "Saved Reports.tsx" },
      { at: at("10:05:40"), message: "Compiling and typechecking the application" }, { at: at("10:05:50"), message: "Repairing a compiler issue · pass 1 of 2" }, { at: at("10:06:05"), message: "Rechecking the repaired application" }, { at: at("10:06:20"), message: "Build complete" }] };
    expect(milestonesFor(resumed).map((m) => m.label)).toEqual(["Resumed: 3 finished files reused, not rewritten", "Wrote 1 file", "Compiled and type-checked after 1 repair", "The build check found errors. Repairing (attempt 1 of 2)", "Rechecking after the repair", "Preview is live"]);
    const stopped: ActivityBuild = { id: "s", status: "cancelled", created_at: at("11:00:00"), checkpoint: { done: ["src/App.tsx"] }, progress: [{ at: at("11:00:01"), message: "Plan approved. Application build queued." }] };
    expect(milestonesFor(stopped).at(-1)).toMatchObject({ label: "You stopped the build", detail: "1 finished file is saved for Resume. Your live version is unchanged." });
  });
});

describe("What I verified", () => {
  it("keeps compilation, a responding preview and the AI review apart, and never claims a browser test", () => {
    const checks = verificationFor(succeeded);
    expect(checks.map((c) => [c.label, c.state])).toEqual([
      ["Compiled and type-checked", "passed"], ["Preview started and responded", "passed"], ["AI review of the code against your plan", "partial"], ["Not tested in a browser yet", "not_run"],
    ]);
    expect(checks[2].detail).toContain("Couldn't confirm: Orders grid 3+ columns wide");
  });

  it("claims a browser test only when one is recorded", () => {
    const tested = { ...succeeded, plan: { ...succeeded.plan, browser_test: { passed: true, checked: ["Add an order", "Filter by status"] } } };
    expect(verificationFor(tested).at(-1)).toEqual({ label: "Tested in a browser", state: "passed", detail: "Add an order, Filter by status" });
  });

  it("reports a failed production build as failed, not as compiled", () => {
    const failed: ActivityBuild = { id: "v", status: "failed", error_code: "BUILD_VALIDATION_FAILED", created_at: at("12:00:00"), progress: [{ at: at("12:00:01"), message: "Compiling and typechecking the application" }] };
    expect(verificationFor(failed)[0]).toMatchObject({ label: "Compiled and type-checked", state: "failed" });
  });
});
