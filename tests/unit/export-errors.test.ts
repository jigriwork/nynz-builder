import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { buildExportZip } from "../../lib/platform/export";
import { apiError, dbError } from "../../lib/http/errors";
import { canSendEmail } from "../../lib/platform/email";
import { safeNext } from "../../lib/http/safe-next";

describe("export archive", () => {
  it("does not overwrite existing export notes or licence files", async () => {
    const zip = await JSZip.loadAsync((await buildExportZip({ name: "Project", files: [{ path: "README.md", content: "customer" }, { path: "NYNZ_EXPORT.md", content: "older notes" }, { path: "LICENSE", content: "customer notices" }], assets: [] })).body);
    expect(await zip.file("NYNZ_EXPORT.md")!.async("string")).toBe("older notes");
    expect(await zip.file("LICENSE")!.async("string")).toBe("customer notices");
    expect(zip.file("NYNZ_EXPORT-2.md")).toBeTruthy();
  });
  it("preserves a project-authored README and excludes secrets and internals", async () => {
    const { body, fileName } = await buildExportZip({ name: "Acme CRM!", date: new Date("2026-11-04"), files: [
      { path: "README.md", content: "# Acme CRM\nOur own docs" }, { path: "src/App.tsx", content: "export default 1" },
      { path: ".env.local", content: "SECRET=1" }, { path: "config/.env", content: "X=1" }, { path: ".nynz-preview.mjs", content: "launcher" }, { path: "node_modules/x/index.js", content: "" },
    ], assets: [{ name: "logo.png", data: new Uint8Array([1, 2]).buffer }] });
    const zip = await JSZip.loadAsync(body);
    expect(Object.keys(zip.files).sort()).toEqual(["NYNZ_EXPORT.md", "README.md", "public/", "public/uploads/", "public/uploads/logo.png", "src/", "src/App.tsx"]);
    expect(await zip.file("README.md")!.async("string")).toBe("# Acme CRM\nOur own docs");
    expect(await zip.file("NYNZ_EXPORT.md")!.async("string")).toMatch(/Exported from NYNZ on 2026-11-04/);
    expect(fileName).toBe("acme-crm.zip");
    const text = (await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map((f) => f.async("string")))).join("\n");
    expect(text).not.toMatch(/lovable|firecrawl|powered by/i);
  });
  it("adds README.md when the project has none", async () => {
    const zip = await JSZip.loadAsync((await buildExportZip({ name: "x", files: [{ path: "index.html", content: "" }], assets: [] })).body);
    expect(zip.file("README.md")).toBeTruthy();
    expect(zip.file("NYNZ_EXPORT.md")).toBeNull();
  });
});

describe("customer-safe errors", () => {
  it("returns a stable code and reference without internal detail, logging a redacted cause", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.OPENROUTER_API_KEY = "sk-or-v1-secretsecretsecret";
    const response = apiError("INTERNAL", "We could not complete that request.", { cause: new Error('duplicate key value violates unique constraint "projects_pkey" using sk-or-v1-secretsecretsecret'), scope: "test" });
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "We could not complete that request.", code: "INTERNAL", ref: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(JSON.stringify(body)).not.toMatch(/projects_pkey|constraint|sk-or/);
    expect(response.headers.get("x-nynz-ref")).toBe(body.ref);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(body.ref);
    expect(logged).not.toContain("sk-or-v1-secretsecretsecret");
    spy.mockRestore();
  });
  it("maps database function codes to safe messages", async () => {
    expect((await dbError({ message: "INSUFFICIENT_CREDITS" }, "t").json()).code).toBe("INSUFFICIENT_CREDITS");
    expect(dbError({ message: "REVISION_CONFLICT" }, "t").status).toBe(409);
    const unknown = await dbError({ message: 'relation "public.secret_table" does not exist' }, "t").json();
    expect(unknown.error).not.toMatch(/secret_table/);
  });
  it("never sends email to reserved test domains and keeps redirects on-site", () => {
    expect(canSendEmail("a@example.com")).toBe(false);
    expect(canSendEmail("a@fixture.test")).toBe(false);
    expect(canSendEmail("a@nynz.in", { NYNZ_EMAIL_DELIVERY: "disabled" })).toBe(false);
    expect(canSendEmail("a@nynz.in", {})).toBe(true);
    expect(safeNext("//evil.com")).toBe("/dashboard");
    expect(safeNext("/api/admin/actions")).toBe("/dashboard");
    expect(safeNext("/admin/team")).toBe("/admin/team");
  });
});
