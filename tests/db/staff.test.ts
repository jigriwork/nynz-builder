import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";

const OWNER_ID = "41080a24-57a9-4686-8d53-c0a3a9e09588";
const OWNER_EMAIL = "adib@nynz.in";
let db: Db;
let owner: Awaited<ReturnType<typeof createUser>>;

const rpc = (user: { id: string; sessionId: string }, sql: string, params: unknown[] = [], extra = {}) =>
  asUser(db, user, async (tx) => (await tx.query<Record<string, any>>(sql, params)).rows[0], extra);
const stale = { amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 3600 }] };

async function staffRow(id: string) {
  return asService(db, async (tx) => (await tx.query<Record<string, any>>("select * from public.staff_members where user_id=$1", [id])).rows[0]);
}
async function auditCount(action: string) {
  return asService(db, async (tx) => Number((await tx.query<{ n: string }>("select count(*) n from public.admin_audit_log where action=$1", [action])).rows[0].n));
}
async function inviteAndAccept(email: string, role: string, caps: string[] = []) {
  const user = await createUser(db, { email });
  const inv = await rpc(owner, "select public.admin_invite_staff($1,'',$2,$3,'hiring') r", [email, role, caps]);
  await rpc(user, "select public.accept_staff_invitation($1)", [inv.r.invitation_id]);
  return user;
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, { id: OWNER_ID, email: OWNER_EMAIL });
  await createUser(db, { email: "someone-else@example.test" });
});

describe("owner bootstrap", () => {
  it("refuses an id/email mismatch and never substitutes another account", async () => {
    expect(await outcome(asService(db, (tx) => tx.query("select public.bootstrap_owner($1,$2)", [OWNER_ID, "someone-else@example.test"])))).toMatch(/OWNER_BOOTSTRAP_EMAIL_MISMATCH/);
    expect(await outcome(asService(db, (tx) => tx.query("select public.bootstrap_owner(gen_random_uuid(),$1)", [OWNER_EMAIL])))).toMatch(/USER_NOT_FOUND/);
    expect(await asService(db, async (tx) => (await tx.query("select * from public.staff_members")).rows.length)).toBe(0);
  });

  it("refuses an unverified email without verifying it", async () => {
    const u = await createUser(db, { email: "unverified@example.test", confirmed: false });
    expect(await outcome(asService(db, (tx) => tx.query("select public.bootstrap_owner($1,$2)", [u.id, u.email])))).toMatch(/EMAIL_NOT_VERIFIED/);
    const confirmed = await db.query("select email_confirmed_at from auth.users where id=$1", [u.id]).then((r) => r.rows[0]);
    expect(confirmed).toEqual({ email_confirmed_at: null });
  });

  it("assigns the exact verified account idempotently and records it", async () => {
    const first = await asService(db, async (tx) => (await tx.query<{ r: string }>("select public.bootstrap_owner($1,$2) r", [OWNER_ID, "ADIB@nynz.in"])).rows[0].r);
    const second = await asService(db, async (tx) => (await tx.query<{ r: string }>("select public.bootstrap_owner($1,$2) r", [OWNER_ID, OWNER_EMAIL])).rows[0].r);
    expect([first, second]).toEqual(["created_owner", "already_owner"]);
    expect(await staffRow(OWNER_ID)).toMatchObject({ role: "owner", status: "active", email: OWNER_EMAIL });
    expect(await auditCount("owner.bootstrap")).toBe(2);
    const access = await rpc(owner, "select public.my_staff_access() a");
    expect(access.a).toMatchObject({ is_staff: true, role: "owner", session_valid: true });
    expect(access.a.capabilities).toContain("owner.manage");
  });

  it("is not callable by customers or staff sessions", async () => {
    expect(await outcome(rpc(owner, "select public.bootstrap_owner($1,$2)", [OWNER_ID, OWNER_EMAIL]))).toMatch(/permission denied/);
  });

  it("owner keeps normal customer workspace access", async () => {
    const project = await rpc(owner, "insert into public.projects(owner_id,name) values($1,'Owner app') returning id", [OWNER_ID]);
    expect(await rpc(owner, "select count(*)::int n from public.projects where id=$1", [project.id])).toEqual({ n: 1 });
  });
});

describe("permission boundaries", () => {
  it("customers and read-only staff cannot mutate", async () => {
    const customer = await createUser(db);
    const victim = await createUser(db);
    expect(await outcome(rpc(customer, "select public.admin_set_account_status($1,'suspended','abuse')", [victim.id]))).toMatch(/PERMISSION_DENIED/);
    expect(await outcome(rpc(customer, "select * from public.admin_audit_log"))).toBe("OK");
    expect(await rpc(customer, "select count(*)::int n from public.admin_audit_log")).toEqual({ n: 0 });
    const reader = await inviteAndAccept("reader@example.test", "readonly");
    expect(await outcome(rpc(reader, "select public.admin_set_account_status($1,'suspended','abuse')", [victim.id]))).toMatch(/PERMISSION_DENIED/);
    expect(await outcome(rpc(reader, "select public.admin_invite_staff('x@example.test','', 'support', '{}', 'r')"))).toMatch(/PERMISSION_DENIED/);
    expect((await rpc(reader, "select count(*)::int n from public.admin_audit_log")).n).toBeGreaterThan(0);
  });

  it("requires recent authentication for sensitive actions", async () => {
    const victim = await createUser(db);
    expect(await outcome(rpc(owner, "select public.admin_set_account_status($1,'suspended','abuse')", [victim.id], stale))).toMatch(/REAUTH_REQUIRED/);
    expect(await outcome(rpc(owner, "select public.admin_set_account_status($1,'suspended','abuse')", [victim.id]))).toBe("OK");
  });

  it("requires MFA once a privileged account has a verified factor", async () => {
    const ops = await inviteAndAccept("ops-mfa@example.test", "operations");
    await db.query("insert into auth.mfa_factors(id,user_id,status) values(gen_random_uuid(),$1,'verified')", [ops.id]);
    const victim = await createUser(db);
    expect(await outcome(rpc(ops, "select public.admin_set_account_status($1,'suspended','abuse')", [victim.id]))).toMatch(/MFA_REQUIRED/);
    expect(await outcome(rpc(ops, "select public.admin_set_account_status($1,'suspended','abuse')", [victim.id], { aal: "aal2" }))).toBe("OK");
  });

  it("support cannot suspend; operations cannot touch an owner", async () => {
    const support = await inviteAndAccept("support@example.test", "support");
    const ops = await inviteAndAccept("ops@example.test", "operations");
    const victim = await createUser(db);
    expect(await outcome(rpc(support, "select public.admin_set_account_status($1,'suspended','x y z')", [victim.id]))).toMatch(/PERMISSION_DENIED/);
    expect(await outcome(rpc(ops, "select public.admin_set_account_status($1,'suspended','x y z')", [OWNER_ID]))).toMatch(/OWNER_ONLY/);
    expect(await outcome(rpc(ops, "select public.admin_revoke_user_sessions($1,'x y z')", [OWNER_ID]))).toMatch(/PERMISSION_DENIED/);
  });
});

describe("invitations", () => {
  it("links an existing verified user without creating a duplicate account", async () => {
    const existing = await createUser(db, { email: "existing@example.test" });
    const before = await db.query("select count(*)::int n from auth.users").then((r) => r.rows[0]);
    const inv = await rpc(owner, "select public.admin_invite_staff('Existing@Example.test','Ex','support','{}','hire') r");
    expect(inv.r.existing_user_id).toBe(existing.id);
    // No privileges before acceptance.
    expect((await rpc(existing, "select public.my_staff_access() a")).a.is_staff).toBe(false);
    const mine = await asUser(db, existing, async (tx) => (await tx.query("select * from public.my_staff_invitations()")).rows);
    expect(mine).toHaveLength(1);
    await rpc(existing, "select public.accept_staff_invitation($1)", [inv.r.invitation_id]);
    expect(await staffRow(existing.id)).toMatchObject({ role: "support", status: "active" });
    expect(await db.query("select count(*)::int n from auth.users").then((r) => r.rows[0])).toEqual(before);
  });

  it("rejects a different account, an unverified email, revoked and expired invitations", async () => {
    const intended = await createUser(db, { email: "intended@example.test", confirmed: false });
    const other = await createUser(db, { email: "other@example.test" });
    const inv = await rpc(owner, "select public.admin_invite_staff('intended@example.test','', 'billing', '{}', 'hire') r");
    expect(await outcome(rpc(other, "select public.accept_staff_invitation($1)", [inv.r.invitation_id]))).toMatch(/INVITATION_EMAIL_MISMATCH/);
    expect(await outcome(rpc(intended, "select public.accept_staff_invitation($1)", [inv.r.invitation_id]))).toMatch(/EMAIL_NOT_VERIFIED/);
    await rpc(owner, "select public.admin_revoke_staff_invitation($1,'mistake')", [inv.r.invitation_id]);
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [intended.id]);
    expect(await outcome(rpc(intended, "select public.accept_staff_invitation($1)", [inv.r.invitation_id]))).toMatch(/INVITATION_INVALID/);
    const again = await rpc(owner, "select public.admin_invite_staff('intended@example.test','', 'billing', '{}', 'hire') r");
    await db.query("update public.staff_invitations set expires_at=now()-interval '1 minute' where id=$1", [again.r.invitation_id]);
    expect(await outcome(rpc(intended, "select public.accept_staff_invitation($1)", [again.r.invitation_id]))).toMatch(/INVITATION_INVALID/);
    await rpc(owner, "select public.admin_resend_staff_invitation($1,'extend')", [again.r.invitation_id]);
    expect(await outcome(rpc(intended, "select public.accept_staff_invitation($1)", [again.r.invitation_id]))).toBe("OK");
  });

  it("only owners invite owners or grant owner-level capabilities; staff cannot exceed their own access", async () => {
    const manager = await inviteAndAccept("manager@example.test", "operations", []);
    // Owner grants team.manage (owner-level) explicitly.
    const s = await staffRow(manager.id);
    await rpc(owner, "select public.admin_update_staff($1,'operations',$2,'{}',null,$3,'delegate hiring')", [manager.id, ["team.manage", "billing.read"], s.version]);
    expect(await outcome(rpc(manager, "select public.admin_invite_staff('newowner@example.test','', 'owner', '{}', 'r')"))).toMatch(/OWNER_ONLY/);
    expect(await outcome(rpc(manager, "select public.admin_invite_staff('x1@example.test','', 'support', $1, 'r')", [["plans.manage"]]))).toMatch(/OWNER_ONLY/);
    expect(await outcome(rpc(manager, "select public.admin_invite_staff('x2@example.test','', 'billing', '{}', 'r')"))).toMatch(/PERMISSION_DENIED/);
    expect(await outcome(rpc(manager, "select public.admin_invite_staff('x3@example.test','', 'readonly', '{}', 'r')"))).toBe("OK");
  });
});

describe("escalation, lockout and revocation", () => {
  it("blocks self-modification and self-promotion", async () => {
    const ops = await inviteAndAccept("self@example.test", "operations");
    const s = await staffRow(ops.id);
    expect(await outcome(rpc(ops, "select public.admin_update_staff($1,'owner','{}','{}',null,$2,'promote me')", [ops.id, s.version]))).toMatch(/PERMISSION_DENIED|SELF_MODIFICATION/);
    expect(await outcome(rpc(owner, "select public.admin_update_staff($1,'operations','{}','{}',null,1,'self')", [OWNER_ID]))).toMatch(/SELF_MODIFICATION/);
    expect(await outcome(asUser(db, ops, (tx) => tx.query("update public.staff_members set role='owner' where user_id=$1", [ops.id])))).toMatch(/permission denied/);
  });

  it("protects the last active owner from demotion, suspension, removal and deletion", async () => {
    expect(await outcome(rpc(owner, "select public.admin_step_down_owner('operations','leaving')"))).toMatch(/LAST_OWNER/);
    expect(await outcome(asService(db, (tx) => tx.query("delete from public.staff_members where user_id=$1", [OWNER_ID])))).toMatch(/permission denied|LAST_OWNER/);
    expect(await outcome(db.query("update public.staff_members set status='suspended' where user_id=$1", [OWNER_ID]))).toMatch(/LAST_OWNER/);
    expect(await staffRow(OWNER_ID)).toMatchObject({ role: "owner", status: "active" });
  });

  it("supports a deliberate two-step ownership transfer", async () => {
    const successor = await inviteAndAccept("successor@example.test", "operations");
    const s = await staffRow(successor.id);
    expect(await outcome(rpc(owner, "select public.admin_update_staff($1,'owner','{}','{}',null,$2,'transfer')", [successor.id, s.version], { amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 600 }] }))).toMatch(/REAUTH_REQUIRED/);
    await rpc(owner, "select public.admin_update_staff($1,'owner','{}','{}',null,$2,'transfer')", [successor.id, s.version]);
    expect(await auditCount("owner.appointed")).toBe(1);
    await rpc(owner, "select public.admin_step_down_owner('readonly','transfer complete')");
    expect(await staffRow(OWNER_ID)).toMatchObject({ role: "readonly" });
    // Restore for the remaining tests.
    const back = await staffRow(OWNER_ID);
    await rpc(successor, "select public.admin_update_staff($1,'owner','{}','{}',null,$2,'restore')", [OWNER_ID, back.version]);
    expect(await staffRow(OWNER_ID)).toMatchObject({ role: "owner" });
  });

  it("suspending or removing staff applies to the next request in an existing session, without touching their customer account", async () => {
    const ops = await inviteAndAccept("revoked@example.test", "operations");
    const project = await rpc(ops, "insert into public.projects(owner_id,name) values($1,'Personal') returning id", [ops.id]);
    expect((await rpc(ops, "select public.my_staff_access() a")).a.is_staff).toBe(true);
    await rpc(owner, "select public.admin_set_staff_status($1,'removed','left team')", [ops.id]);
    expect((await rpc(ops, "select public.my_staff_access() a")).a.is_staff).toBe(false);
    expect(await outcome(rpc(ops, "select public.admin_build_action(gen_random_uuid(),'cancel','x y z')"))).toMatch(/PERMISSION_DENIED/);
    expect(await rpc(ops, "select count(*)::int n from public.projects where id=$1", [project.id])).toEqual({ n: 1 });
    expect(await db.query("select count(*)::int n from auth.users where id=$1", [ops.id]).then((r) => r.rows[0])).toEqual({ n: 1 });
  });

  it("session revocation invalidates staff access immediately", async () => {
    const ops = await inviteAndAccept("sessions@example.test", "operations");
    await rpc(owner, "select public.admin_revoke_user_sessions($1,'compromised')", [ops.id]);
    expect((await rpc(ops, "select public.my_staff_access() a")).a.session_valid).toBe(false);
    expect(await outcome(rpc(ops, "select public.admin_build_action(gen_random_uuid(),'cancel','x y z')"))).toMatch(/PERMISSION_DENIED/);
  });
});

describe("audit history", () => {
  it("is append-only for every role and hash-chained", async () => {
    expect(await outcome(asService(db, (tx) => tx.query("delete from public.admin_audit_log")))).toMatch(/permission denied/);
    expect(await outcome(asService(db, (tx) => tx.query("update public.admin_audit_log set reason='x'")))).toMatch(/permission denied/);
    expect(await outcome(db.query("delete from public.admin_audit_log"))).toMatch(/APPEND_ONLY/);
    expect(await outcome(db.query("truncate public.admin_audit_log"))).toMatch(/APPEND_ONLY/);
    const rows = await asService(db, async (tx) => (await tx.query<{ prev_hash: string | null; hash: string }>("select prev_hash,hash from public.admin_audit_log order by id")).rows);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
  });

  it("redacts secrets in recorded metadata", async () => {
    const id = await rpc(owner, "select public.admin_log_action('users.reset_password','account.password_reset','user',$1,'customer request',$2::jsonb,900) id", [(await createUser(db)).id, JSON.stringify({ token: "abc", api_key: "k", ok: 1 })]);
    const row = await asService(db, async (tx) => (await tx.query<{ metadata: Record<string, unknown> }>("select metadata from public.admin_audit_log where id=$1", [id.id])).rows[0]);
    expect(row.metadata).toEqual({ token: "[redacted]", api_key: "[redacted]", ok: 1 });
  });

  it("a failed mutation leaves no partial change and the audit row commits with the change", async () => {
    const victim = await createUser(db);
    const before = await auditCount("account.suspended");
    expect(await outcome(rpc(owner, "select public.admin_set_account_status($1,'suspended','')", [victim.id]))).toMatch(/INVALID_STATE/);
    expect(await auditCount("account.suspended")).toBe(before);
    await rpc(owner, "select public.admin_set_account_status($1,'suspended','chargeback')", [victim.id]);
    expect(await auditCount("account.suspended")).toBe(before + 1);
  });
});

describe("account deletion", () => {
  it("deleting a removed staff member's account also removes the staff record, but the last owner's account cannot be deleted", async () => {
    const fresh = await createDb();
    const soleOwner = await createUser(fresh, { email: "sole-owner@example.test" });
    await asService(fresh, (tx) => tx.query("select public.bootstrap_owner($1,$2)", [soleOwner.id, soleOwner.email]));
    const temp = await createUser(fresh, { email: "temp-staff@example.test" });
    const inv = await asUser(fresh, soleOwner, async (tx) => (await tx.query<any>("select public.admin_invite_staff($1,'','support','{}','fixture') r", [temp.email])).rows[0].r);
    await asUser(fresh, temp, (tx) => tx.query("select public.accept_staff_invitation($1)", [inv.invitation_id]));
    await asUser(fresh, soleOwner, (tx) => tx.query("select public.admin_set_staff_status($1,'removed','fixture cleanup')", [temp.id]));
    expect(await outcome(fresh.query("delete from auth.users where id=$1", [temp.id]))).toBe("OK");
    expect((await fresh.query("select count(*)::int n from public.staff_members where user_id=$1", [temp.id])).rows[0]).toEqual({ n: 0 });
    expect(await outcome(fresh.query("delete from auth.users where id=$1", [soleOwner.id]))).toMatch(/LAST_OWNER/);
  });
});
