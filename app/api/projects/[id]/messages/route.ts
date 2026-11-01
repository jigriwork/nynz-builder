import { NextResponse } from "next/server";
import { requireProject } from "@/lib/supabase/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const { data: conversation } = await auth.supabase.from("conversations").select("id").eq("project_id", id).order("created_at").limit(1).maybeSingle();
  if (!conversation) return NextResponse.json({ messages: [] });
  const { data, error } = await auth.supabase.from("messages").select("id,role,content,created_at").eq("conversation_id", conversation.id).order("created_at");
  return error ? NextResponse.json({ error: "Could not load conversation" }, { status: 400 }) : NextResponse.json({ messages: data || [] }, { headers: { "cache-control": "private, no-store" } });
}
