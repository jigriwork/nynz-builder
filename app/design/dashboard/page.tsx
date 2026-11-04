import { notFound } from "next/navigation";
import DashboardClient from "@/app/dashboard/dashboard-client";

export default function DashboardDesignFixture() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DashboardClient account={{ email: "hello@nynz.in", availableCredits: 120, isStaff: false, canOpenAdmin: false, pendingInvitations: 0 }} initialProjects={[
    { id: "fieldnote", name: "Fieldnote inventory", description: "Inventory dashboard", status: "ready", preview_url: "/design/preview", updated_at: new Date().toISOString() },
    { id: "atlas", name: "Atlas launch room", description: "Launch tracker", status: "building", preview_url: null, updated_at: new Date(Date.now() - 86_400_000).toISOString() },
    { id: "northstar", name: "Northstar members", description: "Member portal", status: "draft", preview_url: null, updated_at: new Date(Date.now() - 172_800_000).toISOString() },
  ]} />;
}
