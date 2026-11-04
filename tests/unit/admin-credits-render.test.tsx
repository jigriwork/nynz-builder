import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/admin/session", () => ({ loadStaff: async () => ({ can: () => false, email: "owner@example.test", user: { id: "owner" }, access: { role: "owner" } }) }));
vi.mock("@/components/admin/action-form", () => ({ ActionForm: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createAdmin: () => ({
  from: (table: string) => {
    const result = { data: table === "credit_ledger" ? fixture.rows : [], error: null };
    const query = {
      select: () => query, order: () => query, limit: () => query, eq: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
    };
    return query;
  },
}) }));

afterEach(() => { fixture.rows = []; vi.unstubAllGlobals(); });

it("renders retained credit history for deleted accounts without crashing or linking to a null user", async () => {
  fixture.rows = [
    { id: 1, user_id: null, entry_type: "grant", amount: 50, reason: "Preserved history", created_at: "2026-11-04T00:00:00Z", cost_paise: null },
    { id: 2, user_id: "11111111-1111-4111-8111-111111111111", entry_type: "consume", amount: -3, reason: "Build", created_at: "2026-11-04T00:00:00Z", cost_paise: null },
  ];
  const { default: CreditsPage } = await import("../../app/admin/credits/page");
  const html = renderToStaticMarkup(await CreditsPage());
  expect(html).toContain("Deleted account");
  expect(html).toContain("Preserved history");
  expect(html).not.toContain("/admin/users/null");
  expect(html).toContain("/admin/users/11111111-1111-4111-8111-111111111111");
});

it("renders an empty ledger", async () => {
  const { default: CreditsPage } = await import("../../app/admin/credits/page");
  expect(renderToStaticMarkup(await CreditsPage())).toContain("No credit activity yet.");
});
