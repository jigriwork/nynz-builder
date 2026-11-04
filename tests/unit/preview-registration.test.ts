import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePreviewRegistered } from "../../lib/preview/registration";

const id = "11111111-1111-4111-8111-111111111111";
const name = `${id}.preview.nynz.in`;
const env = { NODE_ENV: "production", PREVIEW_VERCEL_PROJECT_ID: "private-preview", PREVIEW_VERCEL_TOKEN: "server-only", PREVIEW_VERCEL_TEAM_ID: "team" };
const domain = () => Response.json({ name, verified: true, projectId: "private-preview" });
afterEach(() => vi.unstubAllEnvs());

describe("individual preview certificates", () => {
  it("registers a missing hostname and requires HTTPS before admission", async () => {
    vi.stubEnv("PREVIEW_ORIGIN", "https://{projectId}.preview.nynz.in");
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(domain()).mockResolvedValueOnce(new Response("Preview authorization required", { status: 401 }));
    await ensurePreviewRegistered(id, env, request);
    expect(request.mock.calls[1][1]?.body).toBe(JSON.stringify({ name }));
    expect(String(request.mock.calls[2][0])).toBe(`https://${name}`);
    expect(request.mock.calls[2][1]?.headers).toBeUndefined();
  });
  it("checks an existing attachment without creating another and fails closed on a wrong project", async () => {
    vi.stubEnv("PREVIEW_ORIGIN", "https://{projectId}.preview.nynz.in");
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ name, verified: true, projectId: "publishing" }));
    await expect(ensurePreviewRegistered(id, env, request)).rejects.toThrow("hosting project");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not accept a certificate failure or an unrelated host response", async () => {
    vi.stubEnv("PREVIEW_ORIGIN", "https://{projectId}.preview.nynz.in");
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(domain()).mockRejectedValueOnce(new Error("certificate invalid"));
    await expect(ensurePreviewRegistered(id, env, request)).rejects.toThrow("certificate invalid");
    request.mockResolvedValueOnce(domain()).mockResolvedValueOnce(new Response("login", { status: 200 }));
    await expect(ensurePreviewRegistered(id, env, request)).rejects.toThrow("HTTPS is not ready");
  });
  it("refuses unconfigured production registration", async () => {
    vi.stubEnv("PREVIEW_ORIGIN", "https://{projectId}.preview.nynz.in");
    await expect(ensurePreviewRegistered(id, { NODE_ENV: "production" }, vi.fn())).rejects.toThrow("not configured");
  });
});
