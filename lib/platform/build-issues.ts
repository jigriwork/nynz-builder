/**
 * Plain-language explanations for why a build or preview stopped, keyed by the
 * stable error codes the worker and APIs record. Shared by the builder's chat
 * card, its log view and the preview host's error page so wording matches.
 */
export type IssueTone = "paused" | "credits" | "fixable" | "retry" | "stopped";
export type BuildIssue = { title: string; body: string; tone: IssueTone; action: "retry" | "billing" | "wait" | "ask" | "none" };

const ISSUES: Record<string, BuildIssue> = {
  SPEND_LIMIT: { tone: "paused", action: "wait", title: "NYNZ is very busy right now", body: "So many apps are being built at the moment that yours couldn't start. Nothing in your project changed. Please try again in a few minutes." },
  MODEL_BUDGET_REACHED: { tone: "paused", action: "ask", title: "This request was too large for one build", body: "It needed more work than one build allows. Try a smaller step, for example one screen or feature at a time." },
  INSUFFICIENT_CREDITS: { tone: "credits", action: "billing", title: "You're out of credits for this step", body: "Builds and previews use credits for the AI and cloud time they need. Add credits or choose a plan, then try again." },
  CONCURRENCY_LIMIT: { tone: "credits", action: "billing", title: "Another build is already running", body: "Your plan runs one build at a time. Wait for the current one to finish, or upgrade to run more at once." },
  GENERATOR_UNAVAILABLE: { tone: "retry", action: "retry", title: "The AI builder is briefly unavailable", body: "Our AI provider didn't respond. Nothing was changed and you weren't charged for an unfinished step. Try again in a minute." },
  BUILD_VALIDATION_FAILED: { tone: "fixable", action: "ask", title: "The new code didn't pass its checks", body: "NYNZ tested the changes before publishing them and found errors, so it kept your previous version. Ask NYNZ to fix the build, or try rewording the request." },
  GENERATION_INCOMPLETE: { tone: "retry", action: "retry", title: "The AI returned an incomplete result", body: "Nothing was changed. Trying again usually works." },
  SOURCE_CHANGED: { tone: "fixable", action: "retry", title: "Your files changed during the build", body: "You edited files while NYNZ was building, so it didn't overwrite your edits. Send the request again to build on top of them." },
  WORKER_INTERRUPTED: { tone: "retry", action: "retry", title: "The build was interrupted", body: "The build server restarted part-way through. Nothing was changed; try again." },
  RECOVERED_BY_STAFF: { tone: "stopped", action: "retry", title: "Stopped by NYNZ support", body: "A stuck build was stopped by our team. Your previous version is unchanged." },
  CANCELLED: { tone: "stopped", action: "none", title: "Build cancelled", body: "You stopped this build. Nothing was changed." },
  ACCOUNT_SUSPENDED: { tone: "stopped", action: "none", title: "This account is paused", body: "Builds and previews are paused for this account. Contact NYNZ support for help." },
};
const DEFAULT: BuildIssue = { tone: "retry", action: "retry", title: "This build didn't finish", body: "Something went wrong on our side. Your previous version is unchanged; please try again." };

export function describeIssue(code: string | null | undefined): BuildIssue {
  return (code && ISSUES[code]) || DEFAULT;
}

/** Codes the preview host can report when a preview cannot be woken. */
export function describePreviewIssue(code: string | null | undefined) {
  if (code === "SPEND_LIMIT") return { title: "NYNZ is very busy right now", body: "Your app is safe. Previews are in high demand at the moment, so please reload in a few minutes." };
  if (code === "INSUFFICIENT_CREDITS") return { title: "Not enough credits to wake this preview", body: "Waking a preview uses a few credits for cloud time. Add credits from Plan and billing, then reload." };
  if (code === "NO_PREVIEW") return { title: "This app isn't running right now", body: "Open the project in NYNZ and press Restart preview to start it again." };
  return { title: "Preview couldn't load", body: "The preview didn't respond. Reload in a moment, or restart the preview from your NYNZ project." };
}
