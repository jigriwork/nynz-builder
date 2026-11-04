import { afterEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createAdmin: () => ({ rpc }) }));
import { rateLimit } from "../../lib/platform/rate-limit";

afterEach(() => { vi.restoreAllMocks(); });
describe("rate admission during outages", () => {
  it("fails closed on database error, exception, or malformed response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const result of [{ data: null, error: { message: "database offline" } }, { data: null, error: null }, { data: [], error: null }]) {
      rpc.mockResolvedValueOnce(result);
      expect((await rateLimit("fixture", 5, 60))?.status).toBe(503);
    }
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect((await rateLimit("fixture", 5, 60))?.status).toBe(503);
  });
  it("enforces refusal and accepts only a positive database decision", async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 10 }], error: null });
    const refused = await rateLimit("fixture", 5, 60);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("retry-after")).toBe("10");
    rpc.mockResolvedValueOnce({ data: [{ allowed: true }], error: null });
    expect(await rateLimit("fixture", 5, 60)).toBeNull();
  });
});
