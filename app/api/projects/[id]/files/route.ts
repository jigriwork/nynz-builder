import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/supabase/auth";
import { filesAreSafe } from "@/lib/platform/security";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const auth=await requireProject(id);if("error"in auth)return auth.error;const {data,error}=await auth.supabase.from("project_files").select("path,content,content_hash,updated_at").eq("project_id",id).order("path");return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({files:data});}
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const auth=await requireProject(id);if("error"in auth)return auth.error;const parsed=z.object({files:z.array(z.object({path:z.string(),content:z.string()})).min(1).max(120)}).safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Invalid files"},{status:400});try{const files=filesAreSafe(parsed.data.files);const {error}=await auth.supabase.from("project_files").upsert(files.map(f=>({project_id:id,...f})));if(error)throw error;return NextResponse.json({updated:files.length});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Update failed"},{status:400});}}
