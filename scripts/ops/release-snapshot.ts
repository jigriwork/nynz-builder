/**
 * Read-only snapshot of the owner account and the three validation projects
 * (StudioMark, Kesari Threads, Saffron Loom) and their owner: balance, ledger size and each
 * project's revision, status and preview. Prints no emails or keys.
 *   npx tsx scripts/ops/release-snapshot.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const projects = (await db.from("projects").select("owner_id,name,status,source_revision,preview_revision,active_sandbox_id,updated_at").or("name.ilike.%studiomark%,name.ilike.%kesari%,name.ilike.%saffron%")).data || [];
const owners = [...new Set(projects.map((p) => p.owner_id))];
const owner = owners[0] as string;
const balance = (await db.rpc("credit_balance", { p_user: owner })).data as { available: number; reserved: number; used: number };
const { count: ledger } = await db.from("credit_ledger").select("id", { count: "exact", head: true }).eq("user_id", owner);
console.log(JSON.stringify({ project_owners: owners.length, owner_available: balance.available, owner_reserved: balance.reserved, owner_ledger_rows: ledger, projects: projects.map((p) => ({ name: p.name, status: p.status, source_revision: p.source_revision, preview_revision: p.preview_revision, live_preview: Boolean(p.active_sandbox_id), updated_at: p.updated_at })) }));
