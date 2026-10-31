import { lookup } from "node:dns/promises";
import FirecrawlApp from "@mendable/firecrawl-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { assertPublicHttpUrl, privateIp } from "@/lib/platform/security";

async function resolvePublic(raw:string){const url=assertPublicHttpUrl(raw);const addresses=await lookup(url.hostname,{all:true});if(!addresses.length||addresses.some(a=>privateIp(a.address)))throw new Error("URL resolves to a private address");return url;}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const auth=await requireProject(id);if("error"in auth)return auth.error;
  const parsed=z.object({url:z.string().max(2048)}).safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Invalid URL"},{status:400});
  const key=process.env.FIRECRAWL_API_KEY;if(!key)return NextResponse.json({error:"Firecrawl is not configured"},{status:503});
  const today=new Date();today.setUTCHours(0,0,0,0);const {data:dailyUsage}=await auth.supabase.from("usage_events").select("quantity").eq("kind","firecrawl_pages").gte("created_at",today.toISOString());if((dailyUsage||[]).reduce((sum:number,x:any)=>sum+Number(x.quantity),0)>=Number(process.env.DAILY_FIRECRAWL_PAGE_LIMIT||25))return NextResponse.json({error:"Daily website research limit reached"},{status:429});
  let url:URL;try{url=await resolvePublic(parsed.data.url);}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unsafe URL"},{status:400});}
  const {data:record,error:insertError}=await auth.supabase.from("website_imports").insert({project_id:id,requested_by:auth.user.id,source_url:url.toString()}).select().single();
  if(insertError)return NextResponse.json({error:insertError.message},{status:400});
  try{
    const app=new FirecrawlApp({apiKey:key});
    const result:any=await app.scrape(url.toString(),{formats:["markdown"],onlyMainContent:true,timeout:30_000});
    if(result?.success===false)throw new Error(result.error||"Firecrawl request failed");
    const data=result.data||result;const finalUrl=data?.metadata?.sourceURL||data?.metadata?.url;
    if(finalUrl)await resolvePublic(finalUrl);
    const markdown=String(data?.markdown||"").slice(0,200_000);const title=String(data?.metadata?.title||url.hostname).slice(0,300);
    await auth.supabase.from("website_imports").update({status:"complete",title,markdown,page_count:1}).eq("id",record.id);
    await createAdmin().from("usage_events").insert({owner_id:auth.user.id,project_id:id,kind:"firecrawl_pages",quantity:1,provider:"firecrawl",metadata:{import_id:record.id}});
    return NextResponse.json({import:{id:record.id,title,url:url.toString(),markdown}});
  }catch(error){const message=error instanceof Error?error.message:"Import failed";await auth.supabase.from("website_imports").update({status:"failed",error_message:message}).eq("id",record.id);return NextResponse.json({error:message},{status:502});}
}
