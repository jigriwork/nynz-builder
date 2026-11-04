/**
 * Assigns the NYNZ owner role to one exact, pre-existing account.
 *
 *   pnpm bootstrap:owner --user-id <uuid> --email <address> [--check]
 *
 * Both values are required and must match the same Supabase Auth user. The
 * script never creates users, never changes passwords, never verifies emails
 * and never substitutes another account. It is idempotent: re-running reports
 * "already_owner". The database function re-verifies id, email, email
 * verification and ban state, writes owner_bootstrap_log and an audit event.
 * --check performs the verification only and changes nothing.
 *
 * Recovery: if every owner loses access, an operator with the service-role key
 * runs this for a designated, verified account. See docs/OWNERSHIP.md.
 */
import "dotenv/config";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const userId = arg("user-id");
  const email = arg("email");
  const checkOnly = process.argv.includes("--check");
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId) || !email) throw new Error("Usage: bootstrap-owner --user-id <uuid> --email <address> [--check]");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`[bootstrap-owner] project ${new URL(url).hostname.split(".")[0]}`);

  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data.user) { console.error("[bootstrap-owner] REFUSED: no Supabase Auth user has this ID. No changes made."); process.exit(2); }
  const actual = (data.user.email || "").toLowerCase();
  if (actual !== email.trim().toLowerCase()) { console.error("[bootstrap-owner] REFUSED: this user ID belongs to a different email address. No changes made."); process.exit(3); }
  if (!data.user.email_confirmed_at) { console.error("[bootstrap-owner] REFUSED: the email address is not verified. The owner must confirm it themselves; it is not verified on their behalf."); process.exit(4); }
  console.log("[bootstrap-owner] verified: user ID and email match the same confirmed account");
  if (checkOnly) { console.log("[bootstrap-owner] --check: no changes made"); return; }

  const result = await db.rpc("bootstrap_owner", { p_user: userId, p_email: email });
  if (result.error) { console.error(`[bootstrap-owner] FAILED: ${result.error.message}`); process.exit(5); }
  console.log(`[bootstrap-owner] result: ${result.data}`);
  const { data: staff } = await db.from("staff_members").select("role,status").eq("user_id", userId).single();
  console.log(`[bootstrap-owner] staff record: ${staff?.role} / ${staff?.status}`);
}

main().catch((error) => { console.error(`[bootstrap-owner] ${error instanceof Error ? error.message : "failed"}`); process.exit(1); });
