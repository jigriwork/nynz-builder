import { describe, expect, it } from "vitest";
import { settleSandboxSessions, type SandboxInfo } from "../../lib/billing/sessions";
import { sessionExtensionArgs } from "../../preview-host/lib/runtime";
import { previewErrorCode, previewErrorPage } from "../../preview-host/lib/error-page";
import { sandboxPaisePerSecond } from "../../lib/billing/pricing";

type Call = { fn: string; args: Record<string, unknown> };
function fakeDb(due: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  return { calls, db: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return fn === "sandbox_sessions_to_settle" ? { data: due, error: null } : { data: null, error: null }; } } as never };
}
const row = (id: string, natural: string, terminated: string | null = null) => ({ session_id: id, sandbox_id: `sbx-${id}`, natural_end: natural, terminated_at: terminated, started_at: "2026-11-05T12:00:00Z" });

describe("settling preview sessions from the best evidence", () => {
  it("uses the shutdown record, then the provider's pause time, then NYNZ's visit record, and leaves running sandboxes open", async () => {
    const { db, calls } = fakeDb([
      row("replaced", "2026-11-05T12:20:02Z", "2026-11-05T12:19:53Z"),
      row("paused", "2026-11-05T12:35:20Z"),
      row("gone", "2026-11-05T12:30:00Z"),
      row("running", "2026-11-05T12:30:00Z"),
    ]);
    const info: Record<string, SandboxInfo> = { "sbx-paused": { state: "paused", endAt: "2026-11-05T12:35:10Z" }, "sbx-gone": { state: "gone" }, "sbx-running": { state: "running" } };
    const result = await settleSandboxSessions({ db, sandboxInfo: async (id) => info[id], now: new Date("2026-11-05T13:00:00Z") });
    const settled = calls.filter((c) => c.fn === "settle_sandbox_session").map((c) => [c.args.p_session, c.args.p_ended_at, c.args.p_source]);
    expect(settled).toEqual([
      ["replaced", "2026-11-05T12:19:53.000Z", "shutdown"],
      ["paused", "2026-11-05T12:35:10.000Z", "provider_pause"],
      ["gone", "2026-11-05T12:30:00.000Z", "visit_log"],
    ]);
    expect(result).toEqual({ settled: 3, estimated: 0, open: 1 });
  });

  it("charges a labelled estimate only after the provider has been unreachable for an hour", async () => {
    const early = fakeDb([row("x", "2026-11-05T12:30:00Z")]);
    expect(await settleSandboxSessions({ db: early.db, sandboxInfo: async () => { throw new Error("offline"); }, now: new Date("2026-11-05T12:45:00Z") })).toEqual({ settled: 0, estimated: 0, open: 1 });
    const late = fakeDb([row("x", "2026-11-05T12:30:00Z")]);
    expect(await settleSandboxSessions({ db: late.db, sandboxInfo: async () => ({ state: "unknown" }), now: new Date("2026-11-05T14:00:00Z") })).toEqual({ settled: 0, estimated: 1, open: 0 });
    expect(late.calls.find((c) => c.fn === "settle_sandbox_session")!.args.p_estimate_reason).toMatch(/unavailable/);
  });
});

describe("preview host", () => {
  it("holds a visit's extension before extending runtime, at the configured rate", () => {
    const args = sessionExtensionArgs("sbx", "project", "user", 600, {});
    expect(args).toEqual({ p_project: "project", p_user: "user", p_sandbox: "sbx", p_timeout: 600, p_pps: sandboxPaisePerSecond({}), p_ppc: 100 });
    expect(args.p_pps).toBeCloseTo(0.437, 3);
  });

  it("explains a paused free-trial preview", () => {
    expect(previewErrorCode(new Error("Preview runtime is unavailable or its allowance has been reached: TRIAL_BUDGET"))).toBe("TRIAL_BUDGET");
    expect(previewErrorPage("TRIAL_BUDGET", "https://www.nynz.in")).toContain("Free trial previews are paused for today");
  });
});
