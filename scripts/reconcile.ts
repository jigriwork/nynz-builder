/** One-off resource and credit reconciliation (the worker also runs this every 5 minutes). */
import "dotenv/config";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { reconcileResources } from "../lib/platform/reconcile";
import { listNynzSandboxes, stopE2B } from "../lib/platform/e2b";
import { removePreviewDomain } from "../lib/preview/registration";

config({ path: ".env.local", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
reconcileResources({
  db, idleDays: Number(process.env.PREVIEW_IDLE_DAYS || 7),
  killSandbox: stopE2B,
  removePreviewDomain,
  listSandboxes: listNynzSandboxes,
}).then((summary) => console.log(JSON.stringify(summary, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
