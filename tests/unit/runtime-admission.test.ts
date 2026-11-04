import { afterEach, describe, expect, it, vi } from "vitest";
import { getPreviewOrigin } from "../../lib/preview/session";
import { runtimeAdmissionArgs } from "../../preview-host/lib/runtime";
import { e2bConnector } from "../../preview-host/lib/core";
import { isPlatformBackend } from "../../lib/integrations/customer-supabase";

const project = "11111111-1111-4111-8111-111111111111";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("runtime admission and origins", () => {
  it("refuses shared production origins, embedded credentials and paths", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PREVIEW_ORIGIN", "https://preview.nynz.in");
    expect(() => getPreviewOrigin(project)).toThrow(/dedicated project hostname/);
    vi.stubEnv("PREVIEW_ORIGIN", "https://user:pass@{projectId}.preview.nynz.in");
    expect(() => getPreviewOrigin(project)).toThrow(/credentials/);
    vi.stubEnv("PREVIEW_ORIGIN", "https://{projectId}.preview.nynz.in/path");
    expect(() => getPreviewOrigin(project)).toThrow(/without a path/);
    vi.stubEnv("PREVIEW_ORIGIN", "https://{projectId}.preview.nynz.in");
    expect(getPreviewOrigin(project)).toBe(`https://${project}.preview.nynz.in`);
  });

  it("reserves the window's full possible runtime and rejects broken prices", () => {
    expect(runtimeAdmissionArgs("sandbox", project, "user", 600, {})).toMatchObject({ p_estimate: 525, p_credits: 6, p_seconds: 600, p_paise_per_credit: 100 });
    expect(() => runtimeAdmissionArgs("s", project, "u", 600, { E2B_COST_USD_PER_SECOND: "NaN" })).toThrow();
  });

  it("never calls the provider if runtime admission is refused", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const connect = e2bConnector("fixture", 600, async () => { throw new Error("SPEND_LIMIT"); });
    await expect(connect("sandbox", project, "user")).rejects.toThrow("SPEND_LIMIT");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes the platform database from a customer database", () => {
    expect(isPlatformBackend("https://platform.supabase.co", "https://platform.supabase.co/")).toBe(true);
    expect(isPlatformBackend("https://customer.supabase.co", "https://platform.supabase.co")).toBe(false);
  });
});
