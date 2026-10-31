import "dotenv/config";
import { config } from "dotenv";
import FirecrawlApp from "@mendable/firecrawl-js";
import { Sandbox } from "@e2b/code-interpreter";
import { generateWithSarvam } from "../lib/platform/sarvam";

config({ path: ".env.local", quiet: true });

async function main(){
 const missing=["SARVAM_API_KEY","FIRECRAWL_API_KEY","E2B_API_KEY"].filter(k=>!process.env[k]);if(missing.length)throw new Error(`Missing: ${missing.join(", ")}`);
 const modelsResponse=await fetch(`${process.env.SARVAM_BASE_URL||"https://api.sarvam.ai/v2"}/models`,{headers:{authorization:`Bearer ${process.env.SARVAM_API_KEY}`}});if(!modelsResponse.ok)throw new Error(`Sarvam model discovery failed (${modelsResponse.status})`);const models:any=await modelsResponse.json();console.log(`Sarvam models enabled: ${(models.data||[]).map((m:any)=>m.id).join(", ")}`);
 const sarvam=await generateWithSarvam({prompt:"Create a single App.tsx that renders the text NYNZ integration check.",files:[]});console.log(`Sarvam OK: ${sarvam.model}, ${sarvam.result.files.length} file(s)`);
 const firecrawl:any=await new FirecrawlApp({apiKey:process.env.FIRECRAWL_API_KEY!}).scrape("https://example.com",{formats:["markdown"],onlyMainContent:true,timeout:15000});if(firecrawl?.success===false)throw new Error(firecrawl.error);console.log("Firecrawl OK: 1 public page");
 const sandbox=await Sandbox.create({apiKey:process.env.E2B_API_KEY!,timeoutMs:120000});try{await sandbox.files.write("/home/user/check.txt","nynz");const read=await sandbox.files.read("/home/user/check.txt");const command=await sandbox.commands.run("test -f /home/user/check.txt && echo ok");if(String(read)!=="nynz"||command.exitCode!==0)throw new Error("E2B read/write/command check failed");console.log(`E2B OK: ${sandbox.sandboxId}, https://${sandbox.getHost(3000)}`);}finally{await sandbox.kill();console.log("E2B cleanup OK");}
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exit(1)});
