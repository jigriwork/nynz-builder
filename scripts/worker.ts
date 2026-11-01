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
async function replaceProjectFiles(projectId:string,existing:Array<{path:string}>,next:Array<{path:string;content:string}>){
 const {error:writeError}=await db.from("project_files").upsert(next.map((file:any)=>({project_id:projectId,...file})));
 if(writeError)throw writeError;
 const nextPaths=new Set(next.map(file=>file.path));
 const stale=existing.map(file=>file.path).filter(path=>!nextPaths.has(path));
 if(stale.length){const {error:deleteError}=await db.from("project_files").delete().eq("project_id",projectId).in("path",stale);if(deleteError)throw deleteError;}
}
async function processJob(job:any){
 try{
  const [{data:project},{data:files},{data:imports},{data:backend}]=await Promise.all([db.from("projects").select("*").eq("id",job.project_id).single(),db.from("project_files").select("path,content").eq("project_id",job.project_id),db.from("website_imports").select("title,source_url,markdown").eq("project_id",job.project_id).eq("status","complete").order("created_at",{ascending:false}).limit(3),db.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id",job.project_id).maybeSingle()]);
  if(!project)throw new Error("Project no longer exists");await progress(job,"Preparing project context","planning");if(await cancelled(job))return;
  let output:any=null;
  if(job.mode!=="restart"){
   await progress(job,"Generating your application","generating");
   const importedReferences=(imports||[]).map((x:any)=>`SOURCE ${x.source_url} (${x.title})\n${x.markdown}`).join("\n\n");
   const backendContext=backend?"A Supabase backend is connected to this generated application. Use VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from the runtime environment for requested database or authentication features. Use row-level security and never request or embed a service-role key.":"";
   const references=[importedReferences,backendContext].filter(Boolean).join("\n\n");
   const generationFiles=job.mode==="create"?[]:files||[];
   output=await generateWithSarvam({prompt:job.prompt,files:generationFiles,references,mode:job.mode==="create"?"create":"edit",onAttempt:async(attempt)=>{if(attempt>1)await progress(job,`Refining the generated application · pass ${attempt} of 3`,"generating");}});
   await db.from("build_jobs").update({plan:output.result.plan}).eq("id",job.id);
   if(output.result.files.length){
    if(job.mode==="create")await replaceProjectFiles(job.project_id,files||[],output.result.files);
    else {const {error}=await db.from("project_files").upsert(output.result.files.map((f:any)=>({project_id:job.project_id,...f})));if(error)throw error;}
   }
   await db.from("usage_events").insert([{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_input_tokens",quantity:output.usage.prompt_tokens||0,provider:"sarvam",model:output.model,provider_request_id:output.requestId},{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_output_tokens",quantity:output.usage.completion_tokens||0,provider:"sarvam",model:output.model,provider_request_id:output.requestId}]);
  }
  if(await cancelled(job))return;await progress(job,"Preparing a secure preview environment","installing");
  let {data:current}=await db.from("project_files").select("path,content").eq("project_id",job.project_id);const started=Date.now();let sandbox;
  try{sandbox=await runInE2B(current||[],backend?{projectUrl:backend.project_url,publishableKey:backend.publishable_key}:undefined);}catch(error){
   const detail=error instanceof Error?error.message:"Production build failed";
   if(job.mode==="restart"||!detail.startsWith("Production build failed"))throw error;
   await progress(job,"Repairing a production build issue","generating");
   const repair=await generateWithSarvam({prompt:`Fix the production build errors below. Preserve the requested product and design. Return only files that need correction.\n\nBUILD ERRORS:\n${detail.slice(0,6000)}`,files:current||[],mode:"edit",onAttempt:async(attempt)=>{if(attempt>1)await progress(job,`Refining the build repair · pass ${attempt} of 3`,"generating");}});
   if(repair.result.files.length)await db.from("project_files").upsert(repair.result.files.map((f:any)=>({project_id:job.project_id,...f})));
   await db.from("usage_events").insert([{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_input_tokens",quantity:repair.usage.prompt_tokens||0,provider:"sarvam",model:repair.model,provider_request_id:repair.requestId},{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_output_tokens",quantity:repair.usage.completion_tokens||0,provider:"sarvam",model:repair.model,provider_request_id:repair.requestId}]);
   ({data:current}=await db.from("project_files").select("path,content").eq("project_id",job.project_id));
   await progress(job,"Rebuilding the corrected application","installing");
   sandbox=await runInE2B(current||[],backend?{projectUrl:backend.project_url,publishableKey:backend.publishable_key}:undefined);
  }
  if(await cancelled(job)){await stopE2B(sandbox.sandboxId);return;}await progress(job,"Validating production build and preview","validating");
  if(project.active_sandbox_id)stopE2B(project.active_sandbox_id).catch(()=>{});
  const {data:version}=await db.from("versions").insert({project_id:job.project_id,created_by:job.requested_by,label:job.mode==="restart"?"Preview restart":`Build ${new Date().toLocaleString("en-IN")}`,source_build_id:job.id}).select().single();
  const {data:saved}=await db.from("project_files").select("path,content,content_hash").eq("project_id",job.project_id);if(version&&saved?.length)await db.from("version_files").insert(saved.map((f:any)=>({version_id:version.id,...f})));
  await db.from("projects").update({status:"ready",active_sandbox_id:sandbox.sandboxId,preview_url:getPreviewOrigin(job.project_id),sandbox_expires_at:sandbox.expiresAt,active_version_id:version?.id||project.active_version_id,last_error:null}).eq("id",job.project_id);
  await db.from("build_jobs").update({status:"succeeded",finished_at:new Date().toISOString(),progress:[...job.progress,{at:new Date().toISOString(),message:"Build complete"}]}).eq("id",job.id);
  await db.from("usage_events").insert({owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"sandbox_seconds",quantity:Math.ceil((Date.now()-started)/1000),provider:"e2b"});
  if(job.conversation_id&&output)await db.from("messages").insert({conversation_id:job.conversation_id,role:"assistant",content:output.result.message,metadata:{build_id:job.id,plan:output.result.plan}});
 }catch(error){const internalMessage=error instanceof Error?error.message:"Unknown build failure";console.error(`[NYNZ worker] build ${job.id} failed: ${internalMessage}`);const publicMessage="We couldn't complete this build. Please try again.";await db.from("build_jobs").update({status:"failed",error_code:"BUILD_FAILED",error_message:publicMessage,finished_at:new Date().toISOString()}).eq("id",job.id);await db.from("projects").update({status:"failed",last_error:publicMessage}).eq("id",job.project_id);}
}
async function main(){console.log(`[NYNZ worker] ${worker} started`);for(;;){const {data,error}=await db.rpc("claim_build_job",{worker_name:worker});if(error){console.error(error.message);await wait(5000);continue;}const job=data?.[0];if(!job){await wait(2000);continue;}await processJob(job);}}
main().catch(error=>{console.error(error);process.exit(1)});
