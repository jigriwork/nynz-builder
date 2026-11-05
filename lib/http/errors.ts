import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { redact } from "@/lib/platform/redact";
import { redactPreviewUrl } from "@/lib/preview/token";

/**
 * Customer-safe API errors. Responses carry a stable code, a plain-language
 * message and a correlation ID; the detailed (redacted) cause is written only
 * to server logs under the same ID so support can find it.
 */
export type ApiErrorCode =
  | "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT" | "RATE_LIMITED" | "ACCOUNT_SUSPENDED"
  | "INSUFFICIENT_CREDITS" | "CONCURRENCY_LIMIT" | "SPEND_LIMIT" | "TRIAL_BUDGET" | "SERVICE_UNAVAILABLE" | "REAUTH_REQUIRED" | "MFA_REQUIRED" | "INTERNAL";

const STATUS: Record<ApiErrorCode, number> = {
  AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID_INPUT: 400, CONFLICT: 409, RATE_LIMITED: 429, ACCOUNT_SUSPENDED: 403,
  INSUFFICIENT_CREDITS: 402, CONCURRENCY_LIMIT: 429, SPEND_LIMIT: 503, TRIAL_BUDGET: 429, SERVICE_UNAVAILABLE: 503, REAUTH_REQUIRED: 401, MFA_REQUIRED: 401, INTERNAL: 500,
};

export function correlationId() {
  return randomUUID();
}

export function logServerError(scope: string, error: unknown, id = correlationId()) {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
  console.error(`[${scope}] ref=${id} ${redactPreviewUrl(redact(raw)).slice(0, 2000)}`);
  return id;
}

export function apiError(code: ApiErrorCode, message: string, options: { cause?: unknown; scope?: string; headers?: Record<string, string>; extra?: Record<string, unknown> } = {}) {
  const id = options.cause !== undefined ? logServerError(options.scope || "api", options.cause) : correlationId();
  return NextResponse.json({ error: message, code, ref: id, ...options.extra }, { status: STATUS[code], headers: { "cache-control": "private, no-store", "x-nynz-ref": id, ...options.headers } });
}

/** Maps errors raised by NYNZ database functions (RAISE 'CODE') to safe responses. */
const DB_CODES: Record<string, [ApiErrorCode, string]> = {
  SANDBOX_NOT_BOUND: ["CONFLICT", "The preview is not available for this project. Restart the preview."],
  BUILD_ACTIVE: ["CONFLICT", "A build is running for this project. Wait for it to finish or cancel it first."],
  REVISION_CONFLICT: ["CONFLICT", "This project changed since you opened it. Refresh to load the latest files."],
  FILE_CONFLICT: ["CONFLICT", "This file was changed elsewhere. Refresh to load the latest version before saving."],
  PROJECT_NOT_FOUND: ["NOT_FOUND", "Project not found."],
  VERSION_NOT_FOUND: ["NOT_FOUND", "Version not found."],
  NOT_PROJECT_OWNER: ["NOT_FOUND", "Project not found."],
  ACCOUNT_SUSPENDED: ["ACCOUNT_SUSPENDED", "This account is suspended. Contact support for help."],
  INSUFFICIENT_CREDITS: ["INSUFFICIENT_CREDITS", "You do not have enough credits for this request. Add credits or upgrade your plan."],
  CONCURRENCY_LIMIT: ["CONCURRENCY_LIMIT", "You have reached the number of builds that can run at once on your plan."],
  TRIAL_BUDGET: ["TRIAL_BUDGET", "Free trial building is paused for today because today's shared trial allowance is used up. Your projects are safe. Try again tomorrow, or choose a plan to continue now."],
  SPEND_LIMIT: ["SPEND_LIMIT", "Generation is paused because a platform spending limit was reached. Please try again later."],
  PERMISSION_DENIED: ["FORBIDDEN", "You do not have permission to do that."],
  REAUTH_REQUIRED: ["REAUTH_REQUIRED", "Confirm your password to continue."],
  MFA_REQUIRED: ["MFA_REQUIRED", "Complete two-factor verification to continue."],
  SELF_MODIFICATION: ["FORBIDDEN", "You cannot change your own staff access."],
  LAST_OWNER: ["CONFLICT", "NYNZ must always have at least one active owner."],
  OWNER_ONLY: ["FORBIDDEN", "Only an owner can do that."],
  INVITATION_INVALID: ["NOT_FOUND", "This invitation is no longer valid."],
  INVITATION_EMAIL_MISMATCH: ["FORBIDDEN", "This invitation was sent to a different email address."],
  EMAIL_NOT_VERIFIED: ["FORBIDDEN", "Verify your email address before accepting this invitation."],
  DUPLICATE: ["CONFLICT", "That request was already processed."],
  LIMIT_EXCEEDED: ["FORBIDDEN", "This amount exceeds the limit for your role."],
  STALE_VERSION: ["CONFLICT", "This record changed. Refresh and try again."],
  INVALID_STATE: ["CONFLICT", "That action is not possible in the current state."],
};

export function dbError(error: { message?: string } | null | undefined, scope: string, fallback = "We could not complete that request. Please try again.") {
  const code = String(error?.message || "").trim().split(/\s/)[0];
  const known = DB_CODES[code];
  if (known) return apiError(known[0], known[1]);
  return apiError("INTERNAL", fallback, { cause: error, scope });
}
