import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), kill: vi.fn(), write: vi.fn() }));
vi.mock("@e2b/code-interpreter", () => ({ Sandbox: { create: fixture.create } }));
import { INSTALL_COMMAND, runInE2B, sandboxTimeoutMs } from "../../lib/platform/e2b";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function sandbox() {
  vi.stubEnv("E2B_API_KEY", "fixture");
  fixture.kill.mockResolvedValue(undefined);
  fixture.write.mockResolvedValue(undefined);
  fixture.run.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
  fixture.create.mockResolvedValue({ sandboxId: "fixture", trafficAccessToken: "fixture", getHost: () => "fixture.e2b.test", files: { write: fixture.write }, commands: { run: fixture.run }, kill: fixture.kill });
}

describe("sandbox admission and dependency lifecycle", () => {
  it("does not allocate any sandbox if the budget refuses it", async () => {
    sandbox();
    await expect(runInE2B([], undefined, [], { beforeCreate: async () => { throw new Error("SPEND_LIMIT"); } })).rejects.toThrow("SPEND_LIMIT");
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("registers before file writes and suppresses package install hooks", async () => {
    sandbox();
    const registered = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => new Response(init?.headers ? "<html>fixture</html>" : "denied", { status: init?.headers ? 200 : 403 })));
    await runInE2B([{ path: ".npmrc", content: "ignore-scripts=false" }], undefined, [], { onCreated: registered });
    expect(registered.mock.invocationCallOrder[0]).toBeLessThan(fixture.write.mock.invocationCallOrder[0]);
    expect(fixture.run.mock.calls.some(([command]) => command === INSTALL_COMMAND)).toBe(true);
    expect(INSTALL_COMMAND).toContain("--ignore-scripts");
    expect(fixture.kill).not.toHaveBeenCalled();
  });

  it("kills only the newly allocated sandbox when cancellation interrupts install", async () => {
    sandbox();
    const controller = new AbortController();
    fixture.run.mockImplementation(async () => { controller.abort(new Error("CANCELLED")); throw new Error("sandbox stopped"); });
    await expect(runInE2B([], undefined, [], { signal: controller.signal })).rejects.toThrow("CANCELLED");
    expect(fixture.kill).toHaveBeenCalled();
  });

  it("validates timeouts before accepting an allocation estimate", () => {
    expect(sandboxTimeoutMs({})).toBe(600000);
    expect(sandboxTimeoutMs({ E2B_SANDBOX_TIMEOUT_MS: "99999999" })).toBe(3600000);
    expect(() => sandboxTimeoutMs({ E2B_SANDBOX_TIMEOUT_MS: "NaN" })).toThrow();
  });
});
