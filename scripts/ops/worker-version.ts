/** Read-only: the latest worker heartbeat's version, commit and readiness. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await db.from("worker_heartbeats").select("worker_id,status,last_seen_at,capabilities").order("last_seen_at", { ascending: false }).limit(2);
console.log(JSON.stringify((data || []).map((w) => ({ seen_seconds_ago: Math.round((Date.now() - Date.parse(w.last_seen_at)) / 1000), status: w.status, version: w.capabilities?.version, commit: String(w.capabilities?.commit || "").slice(0, 7), generation: w.capabilities?.generation, sandbox: w.capabilities?.sandbox, preview_origin: w.capabilities?.preview_origin, started: w.capabilities?.started_at }))));
