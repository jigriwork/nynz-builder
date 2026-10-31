import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { stopE2B } from "../lib/platform/e2b";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Supabase worker environment is incomplete");

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID();
const email = `nynz-build-${run}@example.invalid`;
let userId = "";
let projectId = "";
let sandboxId = "";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const createdUser = await db.auth.admin.createUser({ email, password: `Nynz-${run}-Aa1!`, email_confirm: true });
  if (createdUser.error || !createdUser.data.user) throw new Error(`Could not create build verification user: ${createdUser.error?.message}`);
  userId = createdUser.data.user.id;

  const createdProject = await db.from("projects").insert({ owner_id: userId, name: "NYNZ worker verification", description: "Disposable live build" }).select("id").single();
  if (createdProject.error || !createdProject.data) throw new Error(`Could not create build verification project: ${createdProject.error?.message}`);
  projectId = createdProject.data.id;
  const conversation = await db.from("conversations").insert({ project_id: projectId }).select("id").single();
  if (conversation.error || !conversation.data) throw new Error(`Could not create build conversation: ${conversation.error?.message}`);

  const queued = await db.from("build_jobs").insert({
    project_id: projectId,
    requested_by: userId,
    conversation_id: conversation.data.id,
    prompt: "Build a minimal single-page React app with a warm white background and the heading NYNZ live build verified. Use no external packages beyond the starter.",
    mode: "create",
    idempotency_key: run,
  }).select("id").single();
  if (queued.error || !queued.data) throw new Error(`Could not queue live build: ${queued.error?.message}`);

  let previousStatus = "";
  let terminal: { status: string; error_message: string | null } | null = null;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const job = await db.from("build_jobs").select("status,error_message").eq("id", queued.data.id).single();
    if (job.error || !job.data) throw new Error(`Could not read live build: ${job.error?.message}`);
    if (job.data.status !== previousStatus) {
      console.log(`Live build stage: ${job.data.status}`);
      previousStatus = job.data.status;
    }
    if (["succeeded", "failed", "cancelled"].includes(job.data.status)) { terminal = job.data; break; }
    await wait(2_000);
  }
  if (!terminal) throw new Error("Live build did not reach a terminal state within five minutes");

  const [project, files, versions] = await Promise.all([
    db.from("projects").select("status,active_sandbox_id,preview_url,last_error").eq("id", projectId).single(),
    db.from("project_files").select("path").eq("project_id", projectId),
    db.from("versions").select("id").eq("project_id", projectId),
  ]);
  if (project.error || !project.data) throw new Error(`Could not inspect built project: ${project.error?.message}`);
  sandboxId = project.data.active_sandbox_id || "";
  if (!files.data?.length) throw new Error("Live worker finished without persisting generated files");

  if (terminal.status !== "succeeded") {
    throw new Error(`Live build ended as ${terminal.status}: ${terminal.error_message || project.data.last_error || "No error detail"}`);
  }
  if (!project.data.preview_url || !versions.data?.length) throw new Error("Successful live build did not persist its preview and version");
  console.log(`Live build passed with ${files.data.length} generated file(s) and a saved version.`);
} finally {
  if (sandboxId) await stopE2B(sandboxId).catch(() => undefined);
  if (projectId) await db.from("projects").delete().eq("id", projectId);
  if (userId) await db.auth.admin.deleteUser(userId);
}
