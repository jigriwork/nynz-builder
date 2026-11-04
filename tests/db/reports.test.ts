import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";

let db: Db;
let owner: Awaited<ReturnType<typeof createUser>>;
beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, { email: "owner@example.test" });
  await asService(db, (tx) => tx.query("select public.bootstrap_owner($1,$2)", [owner.id, owner.email]));
});

describe("admin reports", () => {
  it("returns real aggregates to permitted staff only", async () => {
    const customer = await createUser(db, { email: "findme@example.test" });
    await asUser(db, customer, (tx) => tx.query("insert into public.projects(owner_id,name) values($1,'Shop')", [customer.id]));
    const overview = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_overview(now()-interval '1 day', now()+interval '1 minute') v")).rows[0].v);
    expect(overview.users.registered).toBe(2);
    expect(overview.projects.total).toBe(1);
    expect(overview.money).toMatchObject({ gross_collected_minor: 0, revenue_net_minor: 0, currency: "INR" });
    expect(await outcome(asUser(db, customer, (tx) => tx.query("select public.admin_overview(now()-interval '1 day', now())")))).toMatch(/PERMISSION_DENIED/);
    const search = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_search_users('findme','all',20,0) v")).rows[0].v);
    expect(search.total).toBe(1);
    expect(search.rows[0]).toMatchObject({ email: "findme@example.test", projects: 1, account_status: "active" });
    const projects = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_search_projects('findme',10) v")).rows[0].v);
    expect(projects[0]).toMatchObject({ name: "Shop", owner_email: "findme@example.test" });
  });

  it("omits sections the caller's role may not see", async () => {
    const support = await createUser(db, { email: "support-r@example.test" });
    const inv = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_invite_staff($1,'','support','{}','hire') r", [support.email])).rows[0].r);
    await asUser(db, support, (tx) => tx.query("select public.accept_staff_invitation($1)", [inv.invitation_id]));
    const detail = await asUser(db, support, async (tx) => (await tx.query<any>("select public.admin_user_detail($1) v", [owner.id])).rows[0].v);
    expect(detail.payments).toBeNull();
    expect(detail.subscriptions).toBeNull();
    expect(detail.credits).not.toBeNull();
  });
});
