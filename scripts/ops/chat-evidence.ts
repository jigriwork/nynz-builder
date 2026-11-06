/** Read-only: what the Saffron Loom builder conversation and build log contain (no customer data beyond the owner's test project). */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: p } = await db.from("projects").select("id,brief").ilike("name", "%saffron%").limit(1).single();
const { data: conv } = await db.from("conversations").select("id").eq("project_id", p!.id).limit(1).single();
const { data: msgs } = await db.from("messages").select("role,content,metadata,created_at").eq("conversation_id", conv!.id).order("created_at");
for (const m of msgs || []) console.log(`[${m.role}${m.metadata?.kind ? `:${m.metadata.kind}` : ""}] ${String(m.content).replace(/\s+/g, " ").slice(0, 260)}`);
const { data: builds } = await db.from("build_jobs").select("status,mode,progress,plan,error_code").eq("project_id", p!.id).order("created_at");
for (const b of builds || []) {
  console.log(`\nBUILD ${b.mode} ${b.status}${b.error_code ? ` ${b.error_code}` : ""}; plan steps: ${(b.plan?.steps || []).length}; coverage: ${JSON.stringify(b.plan?.coverage || {}).slice(0, 160)}`);
  for (const e of (b.progress || []).slice(0, 60)) console.log(`  ${String(e.at).slice(11, 19)} ${e.message}${e.percent !== undefined ? ` (${e.percent}%)` : ""}`);
}
console.log(`\nbrief keys: ${Object.keys(p!.brief || {}).join(", ")}`);
