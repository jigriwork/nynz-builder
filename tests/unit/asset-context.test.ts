import { describe, expect, it } from "vitest";
import { assetReferenceContext } from "../../lib/platform/asset-context";

describe("uploaded asset model context", () => {
  it("includes text catalog contents and the exact public path", async () => {
    const data = new TextEncoder().encode("VIONA Rose Oil, 30 ml, Rs 499").buffer;
    const context = await assetReferenceContext([{ name: "123e4567-e89b-12d3-a456-426614174000-products.csv", data }]);
    expect(context).toContain("products.csv");
    expect(context).toContain("VIONA Rose Oil, 30 ml, Rs 499");
    expect(context).toContain("/uploads/123e4567-e89b-12d3-a456-426614174000-products.csv");
  });

  it("lists binary assets without treating them as text", async () => {
    const context = await assetReferenceContext([{ name: "123e4567-e89b-12d3-a456-426614174000-bottle.png", data: new Uint8Array([1, 2]).buffer }]);
    expect(context).toContain("UPLOADED ASSET: bottle.png");
  });
});
