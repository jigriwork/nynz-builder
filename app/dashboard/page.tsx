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
  const [{ data: projects }, account] = await Promise.all([
    supabase.from("projects").select("id,name,description,status,preview_url,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    accountSummary(supabase, user.email || ""),
  ]);
  return <DashboardClient initialProjects={projects || []} account={account} />;
}
