import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appNameFrom, completionMessage } from "../../lib/platform/build-engine";

/** Evidence: NYNZ 0.4.1 posted Saffron Loom's plan proposal as its "build complete" reply. */
const saffron = JSON.parse(readFileSync("tests/fixtures/saffron-loom/completion.json", "utf8"));
const kesariEdit = JSON.parse(readFileSync("tests/fixtures/kesari-threads/edit-review.json", "utf8"));
const PROPOSAL = /proposed plan|review it|before I write code|let me know if you'd like any changes/i;

describe("build-complete chat reply", () => {
  it("reproduced: the reply posted for a finished build was the plan proposal", () => {
    expect(saffron.reply_posted_on_completion).toMatch(PROPOSAL);
    expect(saffron.reply_posted_on_completion.startsWith(saffron.proposal.trim().slice(0, 40))).toBe(true);
  });

  it("a completed build is described from its result and points to the preview", () => {
    const message = completionMessage({ mode: "create", appName: appNameFrom([{ path: "index.html", content: saffron.index_html }]), plan: saffron.plan, coverage: saffron.coverage });
    expect(message.split("\n")[0]).toBe("Saffron Loom is built and running in the preview.");
    expect(message).toContain("What's included:");
    expect(message).toContain("Open the Preview tab");
    expect(message).not.toMatch(PROPOSAL);
    // Coverage notes stay honest.
    expect(message).toContain("Couldn't confirm automatically");
    expect(message).not.toContain("Not built yet");
  });

  it("a completed edit names the change and the files it updated", () => {
    const message = completionMessage({ mode: "edit", plan: { summary: "Add a returns and exchanges workflow to Delivered orders" }, changed: ["src/types.ts", "src/store.ts", "src/components/Orders.tsx", "src/components/Returns.tsx"] });
    expect(message.split("\n")[0]).toBe("Your change is live in the preview: add a returns and exchanges workflow to Delivered orders.");
    expect(message).toContain("Updated: types.ts, store.ts, Orders.tsx, Returns.tsx.");
    expect(message).not.toMatch(PROPOSAL);
    expect(kesariEdit.steps.length).toBeGreaterThan(0);
  });

  it("falls back to neutral wording when the result carries no name", () => {
    expect(completionMessage({ mode: "create", plan: null }).split("\n")[0]).toBe("Your app is built and running in the preview.");
    expect(appNameFrom([{ path: "index.html", content: "<title>Kesari Threads — Boutique</title>" }])).toBe("Kesari Threads");
  });
});
