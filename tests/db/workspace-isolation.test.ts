import { describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser } from "./harness";

/** Regression: the owner's personal workspace listed other customers' projects (reported 4 Nov 2026). */
describe("staff workspaces are private", () => {
  it("an owner sees only their own projects, builds, usage, credits and payments through normal queries", async () => {
    const db = await createDb();
    const owner = await createUser(db, { email: "adib@nynz.in" });
    const customer = await createUser(db, { email: "test@test.com" });
    await asService(db, (tx) => tx.query("select public.bootstrap_owner($1,'adib@nynz.in')", [owner.id]));
    const theirs = await asUser(db, customer, async (tx) => (await tx.query<{ id: string }>("insert into public.projects(owner_id,name) values($1,'Customer app') returning id", [customer.id])).rows[0].id);
    await asUser(db, owner, (tx) => tx.query("insert into public.projects(owner_id,name) values($1,'Owner app')", [owner.id]));
    await asService(db, async (tx) => {
      await tx.query("insert into public.build_jobs(project_id,requested_by,prompt,idempotency_key) values($1,$2,'x','k1')", [theirs, customer.id]);
      await tx.query("insert into public.usage_events(owner_id,project_id,kind,quantity,provider) values($1,$2,'model_input_tokens',5,'openrouter')", [customer.id, theirs]);
      await tx.query("select public.grant_credits($1,'promotional',10,null,'promo',null,'k2')", [customer.id]);
    });
    const seen = await asUser(db, owner, async (tx) => ({
      projects: (await tx.query<{ name: string }>("select name from public.projects")).rows.map((r) => r.name),
      builds: (await tx.query("select id from public.build_jobs")).rows.length,
      usage: (await tx.query("select id from public.usage_events")).rows.length,
      ledger: (await tx.query("select id from public.credit_ledger")).rows.length,
      grants: (await tx.query("select id from public.credit_grants")).rows.length,
      profiles: (await tx.query("select id from public.profiles")).rows.length,
    }));
    expect(seen).toEqual({ projects: ["Owner app"], builds: 0, usage: 0, ledger: 0, grants: 0, profiles: 1 });
    expect(await asUser(db, owner, async (tx) => (await tx.query("update public.projects set name='x' where id=$1 returning id", [theirs])).rows.length)).toBe(0);
    // The admin console still reaches customer data through capability-checked functions.
    const found = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_search_projects('Customer',10) v")).rows[0].v);
    expect(found.map((p: { name: string }) => p.name)).toEqual(["Customer app"]);
    const detail = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_user_detail($1) v", [customer.id])).rows[0].v);
    expect(detail.credits.available).toBe(10);
  });
});
