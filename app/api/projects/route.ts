import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/auth";

const input = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(2000).optional() });
export async function GET() {
  const auth=await requireUser(); if("error" in auth)return auth.error;
  const {data,error}=await auth.supabase.from("projects").select("*").order("updated_at",{ascending:false});
  return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({projects:data});
}
export async function POST(request:Request) {
  const auth=await requireUser(); if("error" in auth)return auth.error;
  const parsed=input.safeParse(await request.json()); if(!parsed.success)return NextResponse.json({error:"Invalid project"},{status:400});
  const {data:project,error}=await auth.supabase.from("projects").insert({owner_id:auth.user.id,...parsed.data}).select().single();
  if(error)return NextResponse.json({error:error.message},{status:400});
  await auth.supabase.from("conversations").insert({project_id:project.id});
  return NextResponse.json({project},{status:201});
}
