import { describe,expect,it } from "vitest";
import fs from "node:fs";

describe("platform boundaries",()=>{
 it("never exposes privileged keys as public variables",()=>{const env=fs.readFileSync(".env.example","utf8");expect(env).not.toMatch(/NEXT_PUBLIC_(SARVAM|FIRECRAWL|E2B|SUPABASE_SERVICE)/);});
 it("enables RLS for every ownership table",()=>{const sql=fs.readFileSync("supabase/migrations/20261031000100_nynz_core.sql","utf8");for(const table of ["projects","project_files","conversations","messages","versions","version_files","build_jobs","website_imports","usage_events","generated_backend_connections"])expect(sql).toContain(`alter table public.${table} enable row level security`);});
 it("uses a durable database queue claim",()=>{const sql=fs.readFileSync("supabase/migrations/20261031000100_nynz_core.sql","utf8");expect(sql).toContain("for update skip locked");});
});
