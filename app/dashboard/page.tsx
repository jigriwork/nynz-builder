import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: projects } = await supabase.from("projects").select("id,name,description,status,preview_url,updated_at").order("updated_at", { ascending: false });
  return <DashboardClient initialProjects={projects || []} email={user.email || ""} />;
}
