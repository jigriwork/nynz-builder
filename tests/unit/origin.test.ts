import { describe, expect, it } from "vitest";
import { allowedOrigins, crossOriginWrite } from "../../lib/http/origin";

const allowed = allowedOrigins("www.nynz.in", "https:", { NEXT_PUBLIC_APP_URL: "https://www.nynz.in" });
const req = (over: Partial<Parameters<typeof crossOriginWrite>[0]>) => crossOriginWrite({ method: "POST", path: "/api/projects", origin: null, secFetchSite: null, allowed, ...over });

describe("request-origin protection", () => {
  it("allows NYNZ's own pages and non-browser clients", () => {
    expect(req({ origin: "https://www.nynz.in", secFetchSite: "same-origin" })).toBeNull();
    expect(req({})).toBeNull();
    expect(req({ secFetchSite: "same-origin" })).toBeNull();
  });
  it("refuses data-changing requests from previews, published sites and other sites", () => {
    expect(req({ origin: "https://2ea4dcd1-eac1-4a9b-8c01-12e673f416ee.preview.nynz.in", secFetchSite: "same-site" })).toMatch(/origin/);
    expect(req({ origin: "https://evil.example" })).toMatch(/origin/);
    expect(req({ origin: "null" })).toMatch(/origin/);
    expect(req({ secFetchSite: "same-site" })).toMatch(/fetch site/);
    expect(req({ secFetchSite: "cross-site", method: "DELETE" })).toMatch(/fetch site/);
  });
  it("leaves reads, pages and the signed payment webhook alone", () => {
    expect(req({ method: "GET", origin: "https://evil.example" })).toBeNull();
    expect(req({ path: "/login", origin: "https://evil.example" })).toBeNull();
    expect(req({ path: "/api/webhooks/razorpay", origin: null, secFetchSite: "cross-site" })).toBeNull();
  });
});
