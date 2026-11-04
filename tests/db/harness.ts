/**
 * In-process Postgres (PGlite) that emulates the parts of Supabase the NYNZ
 * migrations depend on: the anon/authenticated/service_role roles, Supabase's
 * default public-schema grants, auth.users/sessions/mfa_factors, auth.uid() and
 * auth.jwt(), and storage.buckets/objects. Every migration in
 * supabase/migrations is applied unmodified, so these tests exercise the real
 * SQL, RLS policies, grants and functions without touching a hosted project.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto schema extensions;
grant usage on schema extensions to public;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users(
  id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}',
  banned_until timestamptz, last_sign_in_at timestamptz, created_at timestamptz not null default now(), deleted_at timestamptz
);
create table auth.sessions(
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), not_after timestamptz, aal text
);
create table auth.mfa_factors(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, status text not null, factor_type text not null default 'totp');
grant select on auth.users to service_role;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets(id text primary key, name text not null, public boolean default false, file_size_limit bigint);
create table storage.objects(
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null,
  owner uuid, created_at timestamptz not null default now(), unique(bucket_id, name)
);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated, service_role;
grant all on storage.buckets to service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

export type Db = PGlite;
export type Claims = { sub?: string; session_id?: string; aal?: string; amr?: Array<{ method: string; timestamp: number }>; role?: string };

export function migrationFiles() {
  const dir = join(process.cwd(), "supabase", "migrations");
  return readdirSync(dir).filter((name) => name.endsWith(".sql")).sort().map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

export async function createDb(options: { until?: string; beforeRest?: (db: Db) => Promise<void> } = {}): Promise<Db> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  let seeded = false;
  for (const migration of migrationFiles()) {
    if (options.until && !seeded && migration.name > options.until) { seeded = true; await options.beforeRest?.(db); }
    try { await db.exec(migration.sql); }
    catch (error) { throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`); }
  }
  return db;
}

export async function createUser(db: Db, input: { email?: string; confirmed?: boolean; id?: string } = {}) {
  const id = input.id || randomUUID();
  const email = input.email || `${id.slice(0, 8)}@example.test`;
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [id, email, input.confirmed === false ? null : new Date().toISOString()]);
  const sessionId = randomUUID();
  await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [sessionId, id]);
  return { id, email, sessionId };
}

/** Freshly authenticated claims (password sign-in "now"). */
export function claimsFor(user: { id: string; sessionId: string }, extra: Partial<Claims> = {}): Claims {
  return { sub: user.id, session_id: user.sessionId, role: "authenticated", aal: "aal1", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }], ...extra };
}

type Role = "anon" | "authenticated" | "service_role";
export async function as<T>(db: Db, role: Role, claims: Claims | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : ""]);
    return fn(tx);
  });
}

export const asService = <T>(db: Db, fn: (tx: Transaction) => Promise<T>) => as(db, "service_role", { role: "service_role" }, fn);
export const asUser = <T>(db: Db, user: { id: string; sessionId: string }, fn: (tx: Transaction) => Promise<T>, extra: Partial<Claims> = {}) =>
  as(db, "authenticated", claimsFor(user, extra), fn);

/** Resolves to the Postgres error message (or "OK") so tests can assert denials. */
export async function outcome(promise: Promise<unknown>) {
  try { await promise; return "OK"; } catch (error) { return (error as Error).message; }
}
