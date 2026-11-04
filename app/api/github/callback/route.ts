import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { GitHubClient, appJwt, githubConfig, verifyState } from "@/lib/integrations/github";

/** Records the installation only when the signed state matches the signed-in user and GitHub confirms it exists. */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const config = githubConfig();
  if (!config) return apiError("SERVICE_UNAVAILABLE", "GitHub is not connected to NYNZ yet.");
  const url = new URL(request.url);
  const installationId = Number(url.searchParams.get("installation_id"));
  if (verifyState(url.searchParams.get("state") || "", config.stateSecret) !== auth.user.id || !Number.isInteger(installationId) || installationId <= 0) return apiError("FORBIDDEN", "This GitHub connection request is not valid. Start again from NYNZ.");
  const response = await fetch(`https://api.github.com/app/installations/${installationId}`, { headers: { authorization: `Bearer ${appJwt(config.appId, config.privateKey)}`, accept: "application/vnd.github+json", "user-agent": "NYNZ" } });
  if (!response.ok) return apiError("FORBIDDEN", "GitHub did not confirm this installation.");
  const installation = await response.json();
  await GitHubClient.forInstallation(config.appId, config.privateKey, installationId);
  await createAdmin().from("github_installations").upsert({ user_id: auth.user.id, installation_id: installationId, account_login: installation?.account?.login || null }, { onConflict: "user_id,installation_id" });
  return NextResponse.redirect(new URL("/dashboard?github=connected", url.origin));
}
