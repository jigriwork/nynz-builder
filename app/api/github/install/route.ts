import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { apiError } from "@/lib/http/errors";
import { githubConfig, signState } from "@/lib/integrations/github";

/** Starts the GitHub App installation, bound to this NYNZ user by signed state. */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const config = githubConfig();
  if (!config || !config.stateSecret) return apiError("SERVICE_UNAVAILABLE", "GitHub is not connected to NYNZ yet.");
  return NextResponse.redirect(`https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(signState(auth.user.id, config.stateSecret))}`);
}
