import { NextResponse } from "next/server";
import { requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { createPreviewExchangeUrl } from "@/lib/preview/session";
import { safeNextPath } from "@/lib/preview/token";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { prepareProjectPreview } from "@/lib/preview/registration";

/**
 * Issues a one-time, host-bound exchange URL for the project's isolated preview
 * origin. The preview host swaps it for an HttpOnly cookie and redirects to a
 * clean URL, so no long-lived credential remains in the address bar, history
 * or logs. GET is used when an expired preview tab renews through the app.
 */
async function issueSession(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const limited = await rateLimit(`preview:${auth.user.id}`, 60, 60);
  if (limited) return limited;
  try {
    const { data, error } = await createAdmin().rpc("authorize_sandbox_access", { p_project: id, p_user: auth.user.id });
    if (error) return apiError("SERVICE_UNAVAILABLE", "The live preview service is temporarily unavailable.", { cause: error, scope: "preview-session" });
    if (!Array.isArray(data) || !data.length) return apiError("CONFLICT", "Preview is not ready");
    await prepareProjectPreview(createAdmin(), id, auth.user.id);
    const next = request.method === "GET" ? safeNextPath(new URL(request.url).searchParams.get("next")) : "/";
    const exchange = createPreviewExchangeUrl(id, auth.user.id, next);
    const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
    if (request.method === "GET") return NextResponse.redirect(exchange.url, { status: 303, headers });
    return NextResponse.json(exchange, { headers });
  } catch (error) {
    return apiError("SERVICE_UNAVAILABLE", "The live preview service is temporarily unavailable.", { cause: error, scope: "preview-session" });
  }
}

export const POST = issueSession;
export const GET = issueSession;
