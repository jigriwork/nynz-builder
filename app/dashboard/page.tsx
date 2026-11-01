import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [{ data: projects }, { data: usage }] = await Promise.all([
    supabase.from("projects").select("id,name,description,status,preview_url,updated_at").order("updated_at", { ascending: false }),
    supabase.from("usage_events").select("kind,quantity").gte("created_at", today.toISOString()),
  ]);
  const modelTokens = (usage || []).filter((item) => item.kind === "model_input_tokens" || item.kind === "model_output_tokens").reduce((sum, item) => sum + Number(item.quantity), 0);
  const creditsUsed = modelTokens ? Math.ceil(modelTokens / 1_000) : 0;
  const creditLimit = Math.ceil(Number(process.env.DAILY_MODEL_TOKEN_LIMIT || 500_000) / 1_000);
  return <DashboardClient initialProjects={projects || []} email={user.email || ""} usage={{ creditsUsed, creditLimit, modelTokens }} />;
}
