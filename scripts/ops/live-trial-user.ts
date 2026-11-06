/** Read-only: the live-trial test account's confirmation state and balance. */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const st = JSON.parse(readFileSync(`${process.env.LIVE_DIR}/state.json`, "utf8"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
const u = data.users.find((x) => x.email === st.inbox.address);
const bal = u ? (await db.rpc("credit_balance", { p_user: u.id })).data : null;
const grants = u ? (await db.from("credit_grants").select("source,amount,remaining,expires_at").eq("user_id", u.id)).data : null;
console.log(JSON.stringify({ exists: Boolean(u), created_at: u?.created_at, email_confirmed_at: u?.email_confirmed_at ?? null, last_sign_in_at: u?.last_sign_in_at ?? null, balance: bal, grants }));
