import { afterEach, describe, expect, it, vi } from "vitest";
import { watchBuild } from "../../lib/platform/build-control";
import { planApplication } from "../../lib/platform/openrouter";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("in-flight build control", () => {
  it.each(["CANCELLED", "LEASE_LOST", "Build authorisation unavailable"])("aborts an active call on %s", async (reason) => {
    vi.useFakeTimers();
    let permitted = true;
    const control = await watchBuild(async () => { if (!permitted) throw new Error(reason); });
    permitted = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(control.signal.aborted).toBe(true);
    expect(control.signal.reason.message).toBe(reason);
    control.stop();
  });

  it("stops polling after completion and refuses a revoked initial lease", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    const control = await watchBuild(check);
    control.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(check).toHaveBeenCalledTimes(1);
    await expect(watchBuild(async () => { throw new Error("LEASE_LOST"); })).rejects.toThrow("LEASE_LOST");
  });

  it("aborts an in-flight planning fetch without issuing a retry", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture");
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      entered();
    }));
    vi.stubGlobal("fetch", fetcher);
    const pending = planApplication({ prompt: "fixture", signal: controller.signal });
    await started;
    controller.abort(new Error("CANCELLED"));
    await expect(pending).rejects.toThrow("CANCELLED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
