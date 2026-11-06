/** Read-only: real charges labelled "Planning the build" in production (amounts only). */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await db.from("credit_ledger").select("amount,cost_paise,created_at,metadata").eq("entry_type", "consume").eq("metadata->>step", "Planning the build").order("created_at");
const credits = (data || []).map((r) => -Number(r.amount));
console.log(JSON.stringify({ planning_requests: credits.length, credits_each: credits, cost_paise_each: (data || []).map((r) => r.cost_paise) }));
