import { NextResponse } from "next/server";
import { requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const auth=await requireProject(id);if("error"in auth)return auth.error;const {data,error}=await createAdmin().from("build_jobs").insert({project_id:id,requested_by:auth.user.id,prompt:"Restart the current application without changing its files.",mode:"restart",idempotency_key:`restart-${Date.now()}-${crypto.randomUUID()}`}).select().single();if(error)return NextResponse.json({error:error.message},{status:400});return NextResponse.json({build:data},{status:202});}
