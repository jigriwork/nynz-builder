import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/supabase/auth";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const auth=await requireProject(id);if("error"in auth)return auth.error;return NextResponse.json({project:auth.project});}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const auth=await requireProject(id);if("error"in auth)return auth.error;const parsed=z.object({name:z.string().trim().min(1).max(100).optional(),description:z.string().max(2000).optional()}).safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Invalid update"},{status:400});const {data,error}=await auth.supabase.from("projects").update(parsed.data).eq("id",id).select().single();return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({project:data});}
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const auth=await requireProject(id);if("error"in auth)return auth.error;const {error}=await auth.supabase.from("projects").delete().eq("id",id);return error?NextResponse.json({error:error.message},{status:400}):new NextResponse(null,{status:204});}
