import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publishableKey || !serviceRoleKey) throw new Error("Supabase environment is incomplete");

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const userOne = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const userTwo = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID();
const password = `Nynz-${randomUUID()}-Aa1!`;
const emails = [`nynz-check-${run}-one@example.invalid`, `nynz-check-${run}-two@example.invalid`];
let userOneId = "";
let userTwoId = "";
let projectId = "";
let assetPath = "";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const createdOne = await admin.auth.admin.createUser({ email: emails[0], password, email_confirm: true });
  const createdTwo = await admin.auth.admin.createUser({ email: emails[1], password, email_confirm: true });
  assert(!createdOne.error && createdOne.data.user, `Could not create first verification user: ${createdOne.error?.message}`);
  assert(!createdTwo.error && createdTwo.data.user, `Could not create second verification user: ${createdTwo.error?.message}`);
  userOneId = createdOne.data.user.id;
  userTwoId = createdTwo.data.user.id;

  const signedInOne = await userOne.auth.signInWithPassword({ email: emails[0], password });
  const signedInTwo = await userTwo.auth.signInWithPassword({ email: emails[1], password });
  assert(!signedInOne.error && signedInOne.data.session, `First verification sign-in failed: ${signedInOne.error?.message}`);
  assert(!signedInTwo.error && signedInTwo.data.session, `Second verification sign-in failed: ${signedInTwo.error?.message}`);

  const profiles = await admin.from("profiles").select("id").in("id", [userOneId, userTwoId]);
  assert(!profiles.error && profiles.data.length === 2, "New-user profile trigger did not create both profiles");

  const createdProject = await userOne.from("projects").insert({ owner_id: userOneId, name: "NYNZ live verification" }).select("id,name").single();
  assert(!createdProject.error && createdProject.data, `Owner project insert failed: ${createdProject.error?.message}`);
  projectId = createdProject.data.id;

  const ownerRead = await userOne.from("projects").select("id,name").eq("id", projectId).single();
  assert(!ownerRead.error && ownerRead.data.id === projectId, "Owner could not read their project");
  const otherRead = await userTwo.from("projects").select("id").eq("id", projectId);
  assert(!otherRead.error && otherRead.data.length === 0, "Cross-user project read was not isolated");

  const otherUpdate = await userTwo.from("projects").update({ name: "unauthorized" }).eq("id", projectId).select("id");
  assert(!otherUpdate.error && otherUpdate.data.length === 0, "Cross-user project update was not isolated");

  const fileWrite = await userOne.from("project_files").insert({ project_id: projectId, path: "src/App.tsx", content: "export default function App(){return null}" });
  assert(!fileWrite.error, `Owner file write failed: ${fileWrite.error?.message}`);

  const forbiddenJob = await userOne.from("build_jobs").insert({ project_id: projectId, requested_by: userOneId, prompt: "verification", idempotency_key: run });
  assert(Boolean(forbiddenJob.error), "Authenticated user unexpectedly inserted a build job directly");

  assetPath = `${projectId}/verification.txt`;
  const upload = await userOne.storage.from("project-assets").upload(assetPath, new TextEncoder().encode("NYNZ verification"), { contentType: "text/plain", upsert: false });
  assert(!upload.error, `Owner storage upload failed: ${upload.error?.message}`);
  const ownerDownload = await userOne.storage.from("project-assets").download(assetPath);
  assert(!ownerDownload.error, `Owner storage read failed: ${ownerDownload.error?.message}`);
  const otherDownload = await userTwo.storage.from("project-assets").download(assetPath);
  assert(Boolean(otherDownload.error), "Cross-user storage read was not isolated");

  await userOne.auth.signOut();
  await userTwo.auth.signOut();
  console.log("Supabase live verification passed: auth, profile trigger, owner CRUD, two-user RLS, restricted queue writes, and private storage.");
} finally {
  if (assetPath) await admin.storage.from("project-assets").remove([assetPath]);
  if (projectId) await admin.from("projects").delete().eq("id", projectId);
  if (userOneId) await admin.auth.admin.deleteUser(userOneId);
  if (userTwoId) await admin.auth.admin.deleteUser(userTwoId);
}
