import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accountSummary } from "@/lib/account";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: projects }, account, { data: cards }] = await Promise.all([
    supabase.from("projects").select("id,name,description,status,preview_url,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    accountSummary(supabase, user.email || ""),
    supabase.rpc("my_project_cards"),
  ]);
  const cardMap = Object.fromEntries(((cards || []) as Array<{ project_id: string; title: string | null; heading: string | null; background: string | null; colors: string[] | null }>).map(({ project_id, ...card }) => [project_id, card]));
  return <DashboardClient initialProjects={projects || []} account={account} cards={cardMap} />;
}
