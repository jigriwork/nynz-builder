import { describe, expect, it } from "vitest";
import { createDb } from "./harness";

/** Applies the pre-0.3 schema, seeds production-shaped data, then upgrades. */
describe("0.3 migrations on existing data", () => {
  it("preserves users, projects, files, conversations, versions and usage; detaches shared sandboxes", async () => {
    const ids = { a: "11111111-1111-4111-8111-111111111111", b: "22222222-2222-4222-8222-222222222222", p1: "aaaaaaaa-0000-4000-8000-000000000001", p2: "aaaaaaaa-0000-4000-8000-000000000002", p3: "aaaaaaaa-0000-4000-8000-000000000003" };
    const db = await createDb({
      until: "20261101000100_worker_reliability.sql",
      beforeRest: async (db) => {
        await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'a@example.test',now()),($2,'b@example.test',now())", [ids.a, ids.b]);
        await db.query("insert into public.projects(id,owner_id,name,status,active_sandbox_id,preview_url) values($1,$4,'A1','ready','sbx-unique','https://p'),($2,$4,'A2','ready','sbx-shared','https://p'),($3,$5,'B1','ready','sbx-shared','https://p')", [ids.p1, ids.p2, ids.p3, ids.a, ids.b]);
        await db.query("insert into public.project_files(project_id,path,content) values($1,'src/App.tsx','hello')", [ids.p1]);
        await db.query("insert into public.conversations(project_id) values($1)", [ids.p1]);
        const v = await db.query<{ id: string }>("insert into public.versions(project_id,created_by,label) values($1,$2,'Build') returning id", [ids.p1, ids.a]);
        await db.query("insert into public.version_files(version_id,path,content,content_hash) values($1,'src/App.tsx','hello','h')", [v.rows[0].id]);
        await db.query("insert into public.usage_events(owner_id,project_id,kind,quantity,provider,estimated_cost_minor) values($1,$2,'model_output_tokens',1000,'openrouter',150)", [ids.a, ids.p1]);
      },
    });
    const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);
    expect(await count("select count(*)::int n from auth.users")).toBe(2);
    expect(await count("select count(*)::int n from public.projects")).toBe(3);
    expect(await count("select count(*)::int n from public.project_files")).toBe(1);
    expect(await count("select count(*)::int n from public.version_files")).toBe(1);
    expect(await count("select count(*)::int n from public.usage_events")).toBe(1);
    // Historical usage is not converted into credits or payments.
    expect(await count("select count(*)::int n from public.credit_grants")).toBe(0);
    expect(await count("select count(*)::int n from public.payments")).toBe(0);
    const projects = (await db.query<{ id: string; active_sandbox_id: string | null; status: string; preview_revision: number | null }>("select id,active_sandbox_id,status,preview_revision from public.projects order by name")).rows;
    expect(projects).toEqual([
      { id: ids.p1, active_sandbox_id: "sbx-unique", status: "ready", preview_revision: expect.any(Number) },
      { id: ids.p2, active_sandbox_id: null, status: "draft", preview_revision: null },
      { id: ids.p3, active_sandbox_id: null, status: "draft", preview_revision: null },
    ]);
    const bound = (await db.query("select provider_ref, project_id from public.platform_resources where kind='e2b_sandbox'")).rows;
    expect(bound).toEqual([{ provider_ref: "sbx-unique", project_id: ids.p1 }]);
    expect(await count("select count(*)::int n from public.platform_resources where kind='storage_prefix'")).toBe(3);
    expect(await count("select count(*)::int n from public.staff_members")).toBe(0);
  });
});
