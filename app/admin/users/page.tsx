import Link from "next/link";
import { loadStaff } from "@/lib/admin/session";
import { Badge, Card, PageHeader, Table, ago, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export const metadata = { title: "Users" };
const FILTERS: Array<[string, string]> = [["all", "All"], ["active_7d", "Active in 7 days"], ["paying", "Paying"], ["unverified", "Unverified"], ["suspended", "Suspended"], ["staff", "Staff"]];
const PAGE = 25;

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, can, email } = await loadStaff("users.read");
  const params = await searchParams;
  const q = params.q || "";
  const filter = FILTERS.some(([key]) => key === params.filter) ? params.filter! : "all";
  const page = Math.max(1, Number(params.page || 1));
  const { data } = await supabase.rpc("admin_search_users", { p_query: q, p_filter: filter, p_limit: PAGE, p_offset: (page - 1) * PAGE });
  const rows = (data?.rows || []) as Array<Record<string, any>>;
  const total = Number(data?.total || 0);
  const link = (next: Record<string, string | number>) => `/admin/users?${new URLSearchParams({ q, filter, page: String(page), ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])) })}`;
  return <>
    <PageHeader title="Users" description="Search by email or user ID. “Seen” is an approximate heartbeat from an open NYNZ tab; “Last activity” is the last meaningful action." />
    <form className="mb-4 flex flex-wrap gap-2"><input name="q" defaultValue={q} placeholder="Email or user ID" className="min-w-[240px] flex-1 rounded-lg border border-white/[.12] bg-[#0a1018] px-3 py-2 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-[#c7ff4a]/50" /><select name="filter" defaultValue={filter} className="rounded-lg border border-white/[.12] bg-[#0a1018] px-3 py-2 text-[12px] text-white">{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><button className="rounded-lg bg-[#c7ff4a] px-4 text-[12px] font-medium text-[#071019]">Search</button></form>
    <Card aside={<span className="text-[11px] text-white/45">{total} matching</span>}>
      <Table head={["Email", "Registered", "Verified", "Last sign-in", "Last activity", "Seen", "Plan", "Projects", "Status"]} rows={rows.map((u) => [
        <Link key="e" href={`/admin/users/${u.id}`} className="text-[#c7ff4a] hover:underline">{u.email}</Link>, when(u.created_at), u.email_confirmed_at ? "Yes" : <Badge tone="warn">No</Badge>,
        ago(u.last_sign_in_at), ago(u.last_activity_at), u.last_presence_at && Date.now() - new Date(u.last_presence_at).getTime() < 120_000 ? <Badge tone="good">online (approx.)</Badge> : ago(u.last_presence_at),
        u.plan_code || "free", u.projects, <span key="s" className="flex flex-wrap gap-1">{u.account_status === "suspended" ? <Badge tone="bad">suspended</Badge> : <Badge>active</Badge>}{u.staff_role && <Badge tone="good">{u.staff_role}</Badge>}</span>,
      ])} empty="No users match." />
      <div className="mt-3 flex justify-between text-[12px]">{page > 1 ? <Link href={link({ page: page - 1 })} className="text-white/70 hover:text-white">← Previous</Link> : <span />}{page * PAGE < total && <Link href={link({ page: page + 1 })} className="text-white/70 hover:text-white">Next →</Link>}</div>
    </Card>
    {can("users.invite") && <Card title="Invite a customer" className="mt-4"><ActionForm action="user.invite" email={email} compact submitLabel="Send invitation" fields={[{ name: "email", label: "Email", type: "email", required: true }, { name: "reason", label: "Reason", required: true, defaultValue: "Customer onboarding" }]} /><p className="mt-2 text-[11px] text-white/45">Sends an account-activation email. The person chooses their own password; NYNZ never sets or sees it.</p></Card>}
  </>;
}
