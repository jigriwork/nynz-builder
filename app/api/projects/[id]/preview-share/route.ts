import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates one reusable, three-hour reviewer link. Creating another link
 * revokes the previous one, so an accidentally shared link is replaceable. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  if (!auth.project.active_sandbox_id) return apiError("CONFLICT", "Start the preview before creating a review link.");
  const admin = createAdmin();
  const now = new Date();
  const expires = new Date(now.getTime() + 3 * 60 * 60_000);
  const token = randomBytes(32).toString("base64url");
  const revoked = await admin.from("preview_share_links").update({ revoked_at: now.toISOString() }).eq("project_id", id).is("revoked_at", null);
  if (revoked.error) return apiError("INTERNAL", "Could not replace the previous review link", { cause: revoked.error, scope: "preview-share" });
  const inserted = await admin.from("preview_share_links").insert({ project_id: id, owner_id: auth.user.id, token_hash: hash(token), expires_at: expires.toISOString() });
  if (inserted.error) return apiError("INTERNAL", "Could not create a review link", { cause: inserted.error, scope: "preview-share" });
  const origin = new URL(request.url).origin;
  return NextResponse.json({ url: `${origin}/review/${token}`, expiresAt: expires.toISOString() }, { status: 201, headers: { "cache-control": "private, no-store" } });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const { error } = await createAdmin().from("preview_share_links").update({ revoked_at: new Date().toISOString() }).eq("project_id", id).is("revoked_at", null);
  return error ? apiError("INTERNAL", "Could not revoke the review link", { cause: error, scope: "preview-share" }) : new NextResponse(null, { status: 204 });
}

