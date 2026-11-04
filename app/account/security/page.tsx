import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { SecurityPanel } from "./security-panel";
import { safeNext } from "@/lib/http/safe-next";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security", robots: { index: false } };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/security");
  const params = await searchParams;
  const { data: staff } = await supabase.rpc("my_staff_access");
  return <AuthShell eyebrow="Account" title="Account security" back={{ href: "/dashboard", label: "Back to workspace" }}>
    <SecurityPanel email={user.email || ""} stepUp={params.stepup === "1"} next={safeNext(params.next, "/dashboard")} privileged={Boolean(staff?.is_staff)} />
  </AuthShell>;
}
