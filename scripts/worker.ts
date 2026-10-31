import "dotenv/config";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { generateWithSarvam } from "../lib/platform/sarvam";
import { runInE2B, stopE2B } from "../lib/platform/e2b";
import { getPreviewOrigin } from "../lib/preview/session";

config({ path: ".env.local", quiet: true });

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error("Worker requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const worker=process.env.WORKER_ID||`worker-${process.pid}`;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function progress(job:any,message:string,status?:string){const events=[...(job.progress||[]),{at:new Date().toISOString(),message}].slice(-100);job.progress=events;await db.from("build_jobs").update({progress:events,...(status?{status}:{})}).eq("id",job.id);}
async function cancelled(job:any){const {data}=await db.from("build_jobs").select("cancel_requested_at").eq("id",job.id).single();if(data?.cancel_requested_at){await db.from("build_jobs").update({status:"cancelled",finished_at:new Date().toISOString()}).eq("id",job.id);await db.from("projects").update({status:"draft"}).eq("id",job.project_id);return true;}return false;}
async function processJob(job:any){
 try{
  const [{data:project},{data:files},{data:imports},{data:backend}]=await Promise.all([db.from("projects").select("*").eq("id",job.project_id).single(),db.from("project_files").select("path,content").eq("project_id",job.project_id),db.from("website_imports").select("title,source_url,markdown").eq("project_id",job.project_id).eq("status","complete").order("created_at",{ascending:false}).limit(3),db.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id",job.project_id).maybeSingle()]);
  if(!project)throw new Error("Project no longer exists");await progress(job,"Preparing project context","planning");if(await cancelled(job))return;
  let output:any=null;
  if(job.mode!=="restart"){
   await progress(job,`Generating with ${process.env.SARVAM_MODEL||"sarvam-105b"}`,"generating");
   const references=(imports||[]).map((x:any)=>`SOURCE ${x.source_url} (${x.title})\n${x.markdown}`).join("\n\n");
   output=await generateWithSarvam({prompt:job.prompt,files:files||[],references});
   await db.from("build_jobs").update({plan:output.result.plan}).eq("id",job.id);
   if(output.result.files.length)await db.from("project_files").upsert(output.result.files.map((f:any)=>({project_id:job.project_id,...f})));
   await db.from("usage_events").insert([{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_input_tokens",quantity:output.usage.prompt_tokens||0,provider:"sarvam",model:output.model,provider_request_id:output.requestId},{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_output_tokens",quantity:output.usage.completion_tokens||0,provider:"sarvam",model:output.model,provider_request_id:output.requestId}]);
  }
  if(await cancelled(job))return;await progress(job,"Installing dependencies in an isolated E2B sandbox","installing");
  const {data:current}=await db.from("project_files").select("path,content").eq("project_id",job.project_id);const started=Date.now();const sandbox=await runInE2B(current||[],backend?{projectUrl:backend.project_url,publishableKey:backend.publishable_key}:undefined);
  if(await cancelled(job)){await stopE2B(sandbox.sandboxId);return;}await progress(job,"Validating production build and preview","validating");
  if(project.active_sandbox_id)stopE2B(project.active_sandbox_id).catch(()=>{});
  const {data:version}=await db.from("versions").insert({project_id:job.project_id,created_by:job.requested_by,label:job.mode==="restart"?"Preview restart":`Build ${new Date().toLocaleString("en-IN")}`,source_build_id:job.id}).select().single();
  const {data:saved}=await db.from("project_files").select("path,content,content_hash").eq("project_id",job.project_id);if(version&&saved?.length)await db.from("version_files").insert(saved.map((f:any)=>({version_id:version.id,...f})));
  await db.from("projects").update({status:"ready",active_sandbox_id:sandbox.sandboxId,preview_url:getPreviewOrigin(job.project_id),sandbox_expires_at:sandbox.expiresAt,active_version_id:version?.id||project.active_version_id,last_error:null}).eq("id",job.project_id);
  await db.from("build_jobs").update({status:"succeeded",finished_at:new Date().toISOString(),progress:[...job.progress,{at:new Date().toISOString(),message:"Build complete"}]}).eq("id",job.id);
  await db.from("usage_events").insert({owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"sandbox_seconds",quantity:Math.ceil((Date.now()-started)/1000),provider:"e2b"});
  if(job.conversation_id&&output)await db.from("messages").insert({conversation_id:job.conversation_id,role:"assistant",content:output.result.message,metadata:{build_id:job.id,plan:output.result.plan}});
 }catch(error){const message=error instanceof Error?error.message:"Unknown build failure";await db.from("build_jobs").update({status:"failed",error_code:"BUILD_FAILED",error_message:message.slice(0,4000),finished_at:new Date().toISOString()}).eq("id",job.id);await db.from("projects").update({status:"failed",last_error:message.slice(0,2000)}).eq("id",job.project_id);}
}
async function main(){console.log(`[NYNZ worker] ${worker} started`);for(;;){const {data,error}=await db.rpc("claim_build_job",{worker_name:worker});if(error){console.error(error.message);await wait(5000);continue;}const job=data?.[0];if(!job){await wait(2000);continue;}await processJob(job);}}
main().catch(error=>{console.error(error);process.exit(1)});
