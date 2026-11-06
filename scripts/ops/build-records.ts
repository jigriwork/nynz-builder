/** Read-only: which saved builds and completion messages exist on the owner's validation projects. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: projects } = await db.from("projects").select("id,name,owner_id").or("name.ilike.%studiomark%,name.ilike.%kesari%,name.ilike.%saffron%");
for (const p of projects || []) {
  const { data: builds } = await db.from("build_jobs").select("id,status,mode,error_code,resumable,resume_of,plan,created_at").eq("project_id", p.id).order("created_at");
  const { data: conv } = await db.from("conversations").select("id").eq("project_id", p.id).limit(1).maybeSingle();
  const { data: msgs } = conv ? await db.from("messages").select("metadata").eq("conversation_id", conv.id) : { data: [] };
  const kinds = (msgs || []).reduce((acc: Record<string, number>, m: any) => { const k = m.metadata?.kind || "plain"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  console.log(`${p.name.slice(0, 18)} (${p.id.slice(0, 8)}): ${(builds || []).map((b: any) => `${b.mode}:${b.status}${b.error_code ? `(${b.error_code})` : ""}${b.resume_of ? "[resume]" : ""}${b.resumable ? "[resumable]" : ""}${b.plan?.coverage ? "[cov]" : ""}`).join(" ")} | messages ${JSON.stringify(kinds)}`);
}
