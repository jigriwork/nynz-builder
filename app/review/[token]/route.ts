import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/supabase/server";
import { createPreviewExchangeUrl } from "@/lib/preview/session";
import { rateLimit } from "@/lib/platform/rate-limit";

const invalid = () => new Response("This private review link is invalid or has expired. Ask the project owner for a new link.", { status: 410, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" } });

/** Exchanges a reusable reviewer URL for the same short-lived, host-bound
 * preview cookie used by the owner. The URL itself never reaches E2B. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return invalid();
  const digest = createHash("sha256").update(token).digest("hex");
  const limited = await rateLimit(`preview-share:${digest}`, 60, 3600);
  if (limited) return limited;
  const admin = createAdmin();
  const { data: link, error } = await admin.from("preview_share_links").select("project_id,owner_id,expires_at,revoked_at").eq("token_hash", digest).maybeSingle();
  if (error || !link || link.revoked_at || Date.parse(link.expires_at) <= Date.now()) return invalid();
  const { data: access, error: accessError } = await admin.rpc("authorize_sandbox_access", { p_project: link.project_id, p_user: link.owner_id });
  if (accessError || !Array.isArray(access) || !access.length) return new Response("This project preview is not running. Ask the owner to restart it in NYNZ.", { status: 409, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" } });
  const exchange = createPreviewExchangeUrl(link.project_id, link.owner_id, "/", Date.parse(link.expires_at));
  return NextResponse.redirect(exchange.url, { status: 303, headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" } });
}

