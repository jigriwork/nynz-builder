import { describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ access: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }), missing: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("next/navigation", () => ({ notFound: fixture.missing, redirect: fixture.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture", email: "staff@example.test" } } }) } }) }));
vi.mock("@/lib/supabase/auth", () => ({ getStaffAccess: fixture.access }));
import { loadStaff } from "../../lib/admin/session";

describe("admin page access", () => {
  it("requires MFA before pages may use their service-role data queries", async () => {
    fixture.access.mockResolvedValue({ is_staff: true, session_valid: true, mfa_satisfied: false, capabilities: ["admin.access", "users.read"] });
    await expect(loadStaff("users.read")).rejects.toThrow("REDIRECT:/account/security?notice=mfa_required");
  });
  it("permits a satisfied staff session and refuses a removed membership", async () => {
    fixture.access.mockResolvedValue({ is_staff: true, session_valid: true, mfa_satisfied: true, capabilities: ["admin.access", "users.read"] });
    expect((await loadStaff("users.read")).can("users.read")).toBe(true);
    fixture.access.mockResolvedValue({ is_staff: false, session_valid: true, mfa_satisfied: true, capabilities: ["admin.access", "users.read"] });
    await expect(loadStaff("users.read")).rejects.toThrow("NOT_FOUND");
  });
});
