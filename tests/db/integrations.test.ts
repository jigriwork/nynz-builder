import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";
import { CUSTOMER_RLS_TEMPLATE } from "../../lib/integrations/backend-templates";

let db: Db;
const svc = async <T = any>(sql: string, params: unknown[] = []) => asService(db, async (tx) => (await tx.query<any>(sql, params)).rows[0] as T);
beforeAll(async () => { db = await createDb(); });

async function deployment(project: string, owner: string, n: number) {
  const id = (await svc("insert into public.deployments(project_id,owner_id,artifact_prefix) values($1,$2,$3) returning id", [project, owner, `published-sites/${project}-${n}`])).id;
  await svc("insert into public.platform_resources(kind,provider_ref,project_id,owner_id,purpose,state) values('deployment_artifact',$1,$2,$3,'publish','active')", [`published-sites/${project}-${n}`, project, owner]);
  return id as string;
}

describe("publishing records", () => {
  it("activates, rolls back, retains five deployments and unpublishes; hosts resolve only live sites", async () => {
    const owner = await createUser(db);
    const project = (await asUser(db, owner, async (tx) => (await tx.query<any>("insert into public.projects(owner_id,name) values($1,'Site') returning id", [owner.id])).rows[0])).id;
    await svc("insert into public.published_sites(project_id,owner_id,slug) values($1,$2,'acme-shop')", [project, owner.id]);
    const ids: string[] = [];
    for (let n = 1; n <= 7; n += 1) { const id = await deployment(project, owner.id, n); ids.push(id); await svc("select public.activate_deployment($1)", [id]); }
    expect(await svc("select active_deployment_id, status from public.published_sites where project_id=$1", [project])).toEqual({ active_deployment_id: ids[6], status: "live" });
    const retired = await asService(db, async (tx) => (await tx.query<any>("select count(*)::int n from public.platform_resources where kind='deployment_artifact' and state='terminating'")).rows[0].n);
    expect(retired).toBe(2);
    expect((await svc("select * from public.resolve_site('acme-shop.nynz.site','nynz.site')")).deployment_id).toBe(ids[6]);
    expect(await svc("select * from public.resolve_site('other.nynz.site','nynz.site')")).toBeUndefined();
    await asUser(db, owner, (tx) => tx.query("select public.rollback_deployment($1,$2)", [project, ids[5]]));
    expect((await svc("select active_deployment_id from public.published_sites where project_id=$1", [project])).active_deployment_id).toBe(ids[5]);
    const stranger = await createUser(db);
    expect(await outcome(asUser(db, stranger, (tx) => tx.query("select public.rollback_deployment($1,$2)", [project, ids[4]])))).toMatch(/NOT_PROJECT_OWNER/);
    await asUser(db, owner, (tx) => tx.query("select public.unpublish_site($1)", [project]));
    expect(await svc("select * from public.resolve_site('acme-shop.nynz.site','nynz.site')")).toBeUndefined();
  });

  it("suspended owners' sites stop resolving", async () => {
    const owner = await createUser(db);
    const project = (await asUser(db, owner, async (tx) => (await tx.query<any>("insert into public.projects(owner_id,name) values($1,'S') returning id", [owner.id])).rows[0])).id;
    await svc("insert into public.published_sites(project_id,owner_id,slug) values($1,$2,'suspended-co')", [project, owner.id]);
    await svc("select public.activate_deployment($1)", [await deployment(project, owner.id, 1)]);
    await svc("insert into public.account_status(user_id,status) values($1,'suspended')", [owner.id]);
    expect(await svc("select * from public.resolve_site('suspended-co.nynz.site','nynz.site')")).toBeUndefined();
  });
});

describe("source import", () => {
  it("imports transactionally with a backup checkpoint and revision check", async () => {
    const owner = await createUser(db);
    const project = (await asUser(db, owner, async (tx) => (await tx.query<any>("insert into public.projects(owner_id,name) values($1,'Imp') returning id", [owner.id])).rows[0])).id;
    await svc("insert into public.project_files(project_id,path,content) values($1,'old.ts','x')", [project]);
    const rev = (await svc("select source_revision from public.projects where id=$1", [project])).source_revision;
    expect(await outcome(svc("select public.import_project_files($1,$2,$3,$4::jsonb,'GitHub import')", [project, owner.id, Number(rev) + 5, JSON.stringify([{ path: "a.ts", content: "1" }])]))).toMatch(/REVISION_CONFLICT/);
    const result = (await svc("select public.import_project_files($1,$2,$3,$4::jsonb,'GitHub import') r", [project, owner.id, rev, JSON.stringify([{ path: "a.ts", content: "1" }])])).r;
    expect(result.backup_version_id).toBeTruthy();
    const files = await asService(db, async (tx) => (await tx.query<any>("select path from public.project_files where project_id=$1", [project])).rows.map((r: any) => r.path));
    expect(files).toEqual(["a.ts"]);
  });
});

describe("generated-app backend template", () => {
  it("isolates two users' rows under RLS in a controlled fixture", async () => {
    const appDb = await createDb();
    await appDb.exec(CUSTOMER_RLS_TEMPLATE("notes"));
    const a = await createUser(appDb), b = await createUser(appDb);
    await asUser(appDb, a, (tx) => tx.query("insert into public.notes(body) values('alice secret')"));
    await asUser(appDb, b, (tx) => tx.query("insert into public.notes(body) values('bob note')"));
    expect(await asUser(appDb, b, async (tx) => (await tx.query<any>("select body from public.notes")).rows)).toEqual([{ body: "bob note" }]);
    expect(await asUser(appDb, b, async (tx) => (await tx.query("update public.notes set body='x' where body='alice secret' returning id")).rows.length)).toBe(0);
    expect(await outcome(asUser(appDb, b, (tx) => tx.query("insert into public.notes(owner_id,body) values($1,'forged')", [a.id])))).toMatch(/row-level security/);
    expect(await outcome(appDb.transaction(async (tx) => { await tx.exec("set local role anon"); return tx.query("select * from public.notes"); }))).toMatch(/permission denied/);
  });
});
