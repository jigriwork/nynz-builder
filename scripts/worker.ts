import "dotenv/config";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateApplication } from "../lib/platform/generation";
import { runInE2B, stopE2B } from "../lib/platform/e2b";
import { getPreviewOrigin } from "../lib/preview/session";
import { redact } from "../lib/platform/redact";

config({ path: ".env.local", quiet: true });

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error("Worker requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const worker=process.env.WORKER_ID||`worker-${process.pid}`;
// Leases are owned by this process instance, so a restarted or overlapping
// instance with the same WORKER_ID can never write to a job it did not claim.
const lockOwner=`${worker}:${randomUUID().slice(0,8)}`;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let shuttingDown=false;let currentBuildId:string|null=null;let heartbeatBusy=false;
function safeError(error:unknown){const raw=error instanceof Error?error.message:typeof error==="object"&&error&&"message"in error?String((error as {message:unknown}).message):String(error);return redact(raw).slice(0,1000);}
function publicFailure(error:unknown){const message=safeError(error);if(/spending limit/i.test(message))return{code:"MODEL_BUDGET_REACHED",message:"This build reached its model spending limit. Reduce the scope or increase the project budget, then try again."};if(/request rejected \((401|402|429)\)/i.test(message))return{code:"GENERATOR_UNAVAILABLE",message:"The application generator is temporarily unavailable or has insufficient balance. Please try again after checking usage."};if(/production build failed|missing dependencies|invalid syntax/i.test(message))return{code:"BUILD_VALIDATION_FAILED",message:"The generated application did not pass production validation. Ask NYNZ to fix the build or try again."};if(/wrong files|incomplete|output limit|truncated|application plan|complete enough/i.test(message))return{code:"GENERATION_INCOMPLETE",message:"The generator returned an incomplete application. No preview was published. Please try again."};return{code:"BUILD_FAILED",message:"We couldn't complete this build. Please try again."};}
async function heartbeat(status=currentBuildId?"working":shuttingDown?"stopping":"idle"){
 if(heartbeatBusy)return;heartbeatBusy=true;
 try{await db.from("worker_heartbeats").upsert({worker_id:worker,status,current_build_id:currentBuildId,last_seen_at:new Date().toISOString(),stopped_at:status==="stopped"?new Date().toISOString():null,...(status==="starting"?{started_at:new Date().toISOString()}:{})},{onConflict:"worker_id"});if(currentBuildId)await db.from("build_jobs").update({locked_at:new Date().toISOString()}).eq("id",currentBuildId).eq("locked_by",lockOwner);}
 catch(error){console.error(`[NYNZ worker] heartbeat failed: ${safeError(error)}`);}
 finally{heartbeatBusy=false;}
}
async function progress(job:any,message:string,status?:string,percent?:number){const events=[...(job.progress||[]),{at:new Date().toISOString(),message,...(typeof percent==="number"?{percent}:{})}].slice(-100);job.progress=events;await db.from("build_jobs").update({progress:events,locked_at:new Date().toISOString(),...(status?{status}:{})}).eq("id",job.id).eq("locked_by",lockOwner);}
async function cancelled(job:any){const {data}=await db.from("build_jobs").select("cancel_requested_at").eq("id",job.id).single();if(data?.cancel_requested_at){await db.from("build_jobs").update({status:"cancelled",finished_at:new Date().toISOString()}).eq("id",job.id).eq("locked_by",lockOwner);await db.from("projects").update({status:"draft"}).eq("id",job.project_id);return true;}return false;}
async function projectAssets(projectId:string){const {data}=await db.storage.from("project-assets").list(projectId,{limit:100});const names=(data||[]).filter((item:any)=>item.id).map((item:any)=>item.name);return Promise.all(names.map(async(name:string)=>{const {data:file,error}=await db.storage.from("project-assets").download(`${projectId}/${name}`);if(error||!file)throw error||new Error(`Could not download asset ${name}`);return{name,data:await file.arrayBuffer()};}));}
async function recordOpenRouterUsage(job:any,event:{prompt_tokens:number;completion_tokens:number;costUsd:number;model:string;requestId:string|null}){const costMinor=Math.round(event.costUsd*Number(process.env.USD_TO_INR_RATE||95)*100);const {error}=await db.from("usage_events").insert([{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_input_tokens",quantity:event.prompt_tokens,provider:"openrouter",model:event.model,provider_request_id:event.requestId},{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_output_tokens",quantity:event.completion_tokens,provider:"openrouter",model:event.model,provider_request_id:event.requestId,estimated_cost_minor:costMinor||null,metadata:{cost_currency:"INR",cost_source:costMinor?"provider_usage":"unavailable"}}]);if(error)console.error(`[NYNZ worker] usage recording failed: ${safeError(error)}`);}
function assistantReply(message:string,mode:string){const base=message.trim()||(mode==="edit"?"Your requested changes are now live.":"Your application is ready and running in the preview.");return /\?\s*$/.test(base)?base:`${base}\n\nWhat would you like to change, add, or improve next?`;}
async function replaceProjectFiles(projectId:string,existing:Array<{path:string}>,next:Array<{path:string;content:string}>){
 const {error:writeError}=await db.from("project_files").upsert(next.map((file:any)=>({project_id:projectId,...file})));
 if(writeError)throw writeError;
 const nextPaths=new Set(next.map(file=>file.path));
 const stale=existing.map(file=>file.path).filter(path=>!nextPaths.has(path));
 if(stale.length){const {error:deleteError}=await db.from("project_files").delete().eq("project_id",projectId).in("path",stale);if(deleteError)throw deleteError;}
}
async function ownsLease(id:string){const {data}=await db.from("build_jobs").select("locked_by,status").eq("id",id).maybeSingle();return data?.locked_by===lockOwner&&!["succeeded","failed","cancelled","queued"].includes(data.status);}
async function processJob(job:any){
 try{
  const [{data:project},{data:files},{data:imports},{data:backend},assets]=await Promise.all([db.from("projects").select("*").eq("id",job.project_id).single(),db.from("project_files").select("path,content").eq("project_id",job.project_id),db.from("website_imports").select("title,source_url,markdown").eq("project_id",job.project_id).eq("status","complete").order("created_at",{ascending:false}).limit(3),db.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id",job.project_id).maybeSingle(),projectAssets(job.project_id)]);
  if(!project)throw new Error("Project no longer exists");await progress(job,"Preparing project context","planning");if(await cancelled(job))return;
  let output:any=null;
  if(job.mode!=="restart"){
   await progress(job,"Generating your application","generating");
   const importedReferences=(imports||[]).map((x:any)=>`SOURCE ${x.source_url} (${x.title})\n${x.markdown}`).join("\n\n");
   const backendContext=backend?"A Supabase backend is connected to this generated application. Use VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from the runtime environment for requested database or authentication features. Use row-level security and never request or embed a service-role key.":"";
   const assetContext=assets.length?`The user uploaded these project assets. They are available in the generated app at these exact public paths:\n${assets.map((asset:any)=>`- /uploads/${asset.name}`).join("\n")}\nUse the relevant uploaded assets when the request mentions a logo, image, document or brand file.`:"";
   const references=[importedReferences,backendContext,assetContext].filter(Boolean).join("\n\n");
   const generationFiles=job.mode==="create"?[]:files||[];
   output=await generateApplication({prompt:job.prompt,files:generationFiles,references,mode:job.mode==="create"?"create":"edit",onAttempt:async(attempt)=>{await progress(job,job.mode==="create"&&attempt>1?`Building application files · batch ${attempt-1}`:attempt>1?`Refining the requested changes · pass ${attempt}`:"Generating your application","generating");},onProgress:async(event)=>progress(job,`Building application files · ${event.current} of ${event.total}`,"generating",event.percent),onUsage:async(event)=>recordOpenRouterUsage(job,event)});
   await db.from("build_jobs").update({plan:output.result.plan}).eq("id",job.id);
   if(output.result.files.length){
    if(job.mode==="create")await replaceProjectFiles(job.project_id,files||[],output.result.files);
    else {const {error}=await db.from("project_files").upsert(output.result.files.map((f:any)=>({project_id:job.project_id,...f})));if(error)throw error;}
   }
   const provider=output.model.startsWith("openrouter:")?"openrouter":"sarvam";const estimatedCostMinor=Math.round(Number(output.usage.costUsd||0)*Number(process.env.USD_TO_INR_RATE||95)*100);
   if(provider!=="openrouter")await db.from("usage_events").insert([{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_input_tokens",quantity:output.usage.prompt_tokens||0,provider,model:output.model,provider_request_id:output.requestId},{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_output_tokens",quantity:output.usage.completion_tokens||0,provider,model:output.model,provider_request_id:output.requestId,estimated_cost_minor:estimatedCostMinor||null,metadata:{cost_currency:"INR",cost_source:estimatedCostMinor?"provider_usage":"unavailable"}}]);
  }
  if(await cancelled(job))return;await progress(job,"Preparing a secure preview environment","installing");
  let {data:current}=await db.from("project_files").select("path,content").eq("project_id",job.project_id);const started=Date.now();let sandbox;
  try{sandbox=await runInE2B(current||[],backend?{projectUrl:backend.project_url,publishableKey:backend.publishable_key}:undefined,assets);}catch(error){
   const detail=error instanceof Error?error.message:"Production build failed";
   if(job.mode==="restart"||!detail.startsWith("Production build failed"))throw error;
   await progress(job,"Repairing a production build issue","generating");
   const repair=await generateApplication({prompt:`Fix the production build errors below. Preserve the requested product and design. Return only files that need correction.\n\nBUILD ERRORS:\n${detail.slice(0,6000)}`,files:current||[],mode:"edit",onAttempt:async(attempt)=>{if(attempt>1)await progress(job,`Refining the build repair · pass ${attempt} of 3`,"generating");},onUsage:async(event)=>recordOpenRouterUsage(job,event)});
   if(repair.result.files.length)await db.from("project_files").upsert(repair.result.files.map((f:any)=>({project_id:job.project_id,...f})));
   const repairProvider=repair.model.startsWith("openrouter:")?"openrouter":"sarvam";const repairCostMinor=Math.round(Number(repair.usage.costUsd||0)*Number(process.env.USD_TO_INR_RATE||95)*100);
   if(repairProvider!=="openrouter")await db.from("usage_events").insert([{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_input_tokens",quantity:repair.usage.prompt_tokens||0,provider:repairProvider,model:repair.model,provider_request_id:repair.requestId},{owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"model_output_tokens",quantity:repair.usage.completion_tokens||0,provider:repairProvider,model:repair.model,provider_request_id:repair.requestId,estimated_cost_minor:repairCostMinor||null,metadata:{cost_currency:"INR",cost_source:repairCostMinor?"provider_usage":"unavailable"}}]);
   ({data:current}=await db.from("project_files").select("path,content").eq("project_id",job.project_id));
   await progress(job,"Rebuilding the corrected application","installing");
   sandbox=await runInE2B(current||[],backend?{projectUrl:backend.project_url,publishableKey:backend.publishable_key}:undefined,assets);
  }
  if(await cancelled(job)){await stopE2B(sandbox.sandboxId);return;}await progress(job,"Validating production build and preview","validating");
  if(!(await ownsLease(job.id))){await stopE2B(sandbox.sandboxId).catch(()=>{});console.error(`[NYNZ worker] build ${job.id} lease lost; discarding result`);return;}
  if(project.active_sandbox_id)stopE2B(project.active_sandbox_id).catch(()=>{});
  const {data:version}=await db.from("versions").insert({project_id:job.project_id,created_by:job.requested_by,label:job.mode==="restart"?"Preview restart":`Build ${new Date().toLocaleString("en-IN")}`,source_build_id:job.id}).select().single();
  const {data:saved}=await db.from("project_files").select("path,content,content_hash").eq("project_id",job.project_id);if(version&&saved?.length)await db.from("version_files").insert(saved.map((f:any)=>({version_id:version.id,...f})));
  await db.from("projects").update({status:"ready",active_sandbox_id:sandbox.sandboxId,preview_url:getPreviewOrigin(job.project_id),sandbox_expires_at:sandbox.expiresAt,active_version_id:version?.id||project.active_version_id,last_error:null}).eq("id",job.project_id);
  // A job recovered after generation runs as a restart but still owes the user a reply.
  if(job.conversation_id&&(output||job.plan)){const {data:posted}=await db.from("messages").select("id").eq("conversation_id",job.conversation_id).eq("metadata->>build_id",job.id).limit(1);if(!posted?.length)await db.from("messages").insert({conversation_id:job.conversation_id,role:"assistant",content:assistantReply(output?.result.message||"",output?job.mode:"edit"),metadata:{build_id:job.id,plan:output?.result.plan||job.plan}});}
  await db.from("build_jobs").update({status:"succeeded",locked_at:null,finished_at:new Date().toISOString(),progress:[...job.progress,{at:new Date().toISOString(),message:"Build complete"}]}).eq("id",job.id).eq("locked_by",lockOwner);
  await db.from("usage_events").insert({owner_id:job.requested_by,project_id:job.project_id,build_id:job.id,kind:"sandbox_seconds",quantity:Math.ceil((Date.now()-started)/1000),provider:"e2b"});
 }catch(error){console.error(`[NYNZ worker] build ${job.id} failed: ${safeError(error)}`);const failure=publicFailure(error);const {data:failed}=await db.from("build_jobs").update({status:"failed",error_code:failure.code,error_message:failure.message,finished_at:new Date().toISOString()}).eq("id",job.id).eq("locked_by",lockOwner).select("id");if(failed?.length)await db.from("projects").update({status:"failed",last_error:failure.message}).eq("id",job.project_id);}
}
for(const signal of ["SIGTERM","SIGINT"] as const)process.on(signal,()=>{if(shuttingDown)return;shuttingDown=true;console.log(`[NYNZ worker] ${lockOwner} ${signal} received; finishing the active build before shutdown`);void heartbeat("stopping");});
async function main(){
 console.log(`[NYNZ worker] ${worker} started (instance ${lockOwner})`);await heartbeat("starting");
 const timer=setInterval(()=>void heartbeat(),15000);timer.unref();let failures=0;let lastRecovery=0;
 while(!shuttingDown){
  if(Date.now()-lastRecovery>60000){const recovery=await db.rpc("recover_stale_build_jobs",{stale_after_seconds:120});if(recovery.error)console.error(`[NYNZ worker] recovery check failed: ${safeError(recovery.error)}`);lastRecovery=Date.now();}
  const {data,error}=await db.rpc("claim_build_job",{worker_name:lockOwner});
  if(error){failures+=1;console.error(`[NYNZ worker] queue poll failed: ${safeError(error)}`);await wait(Math.min(30000,1000*2**Math.min(failures,5)));continue;}
  failures=0;const job=data?.[0];if(!job){await heartbeat();await wait(2000);continue;}
  console.log(`[NYNZ worker] claimed build ${job.id} (${job.mode}, attempt ${job.attempt_count})`);
  currentBuildId=job.id;await heartbeat("working");await processJob(job);console.log(`[NYNZ worker] finished build ${job.id}`);currentBuildId=null;await heartbeat();
 }
 clearInterval(timer);await heartbeat("stopped");console.log(`[NYNZ worker] ${lockOwner} stopped`);process.exit(0);
}
main().catch(async error=>{console.error(`[NYNZ worker] fatal: ${safeError(error)}`);await heartbeat("error").catch(()=>undefined);process.exit(1)});
