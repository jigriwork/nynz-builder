import { describe, expect, it } from "vitest";
import { resolveSitePath, slugFor, validateArtifact, siteHeaders } from "../../preview-host/lib/sites";
import { handleSite } from "../../preview-host/lib/site-host";

const manifest = { files: [
  { path: "index.html", size: 10, sha256: "a".repeat(64), type: "text/html; charset=utf-8" },
  { path: "assets/index-AbC123xy.js", size: 10, sha256: "b".repeat(64), type: "text/javascript; charset=utf-8" },
  { path: "about/index.html", size: 10, sha256: "c".repeat(64), type: "text/html; charset=utf-8" },
] };

describe("published sites", () => {
  it("validates artifacts", () => {
    expect(() => validateArtifact([{ path: "app.js", size: 1 }])).toThrow(/index.html/);
    expect(() => validateArtifact([{ path: "index.html", size: 1 }, { path: "../x", size: 1 }])).toThrow(/Unsafe/);
    expect(() => validateArtifact([{ path: "index.html", size: 1 }, { path: ".env", size: 1 }])).toThrow(/must not include/);
    expect(() => validateArtifact([{ path: "index.html", size: 26 * 1024 * 1024 }])).toThrow(/25 MB/);
    expect(validateArtifact([{ path: "index.html", size: 5 }])).toBe(5);
  });
  it("resolves files, directories and single-page routes", () => {
    expect(resolveSitePath(manifest, "/")?.file.path).toBe("index.html");
    expect(resolveSitePath(manifest, "/about")?.file.path).toBe("about/index.html");
    expect(resolveSitePath(manifest, "/dashboard/settings")?.file.path).toBe("index.html");
    expect(resolveSitePath(manifest, "/missing.png")).toBeNull();
    expect(siteHeaders(manifest.files[1])["cache-control"]).toMatch(/immutable/);
    expect(siteHeaders(manifest.files[0])["cache-control"]).toMatch(/must-revalidate/);
  });
  it("serves only live sites and never reaches a sandbox", async () => {
    const deps = { resolve: async (host: string) => (host === "acme-1a2b3c.nynz.site" ? { deployment_id: "d1", manifest } : null), download: async (path: string) => new TextEncoder().encode(`file ${path}`).buffer as ArrayBuffer };
    expect((await handleSite({ method: "GET", host: "other.nynz.site", url: "/", headers: {} }, deps)).status).toBe(404);
    const page = await handleSite({ method: "GET", host: "acme-1a2b3c.nynz.site", url: "/pricing?x=1", headers: {} }, deps);
    expect(page.status).toBe(200);
    expect(Buffer.from(page.body as ArrayBuffer).toString()).toBe("file d1/index.html");
    expect((await handleSite({ method: "POST", host: "acme-1a2b3c.nynz.site", url: "/", headers: {} }, deps)).status).toBe(405);
    expect(slugFor("Acme Shop!", "1a2b3c4d-0000-4000-8000-000000000000")).toBe("acme-shop-1a2b3c");
  });
});
