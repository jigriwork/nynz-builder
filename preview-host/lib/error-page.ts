/**
 * Branded, self-contained error page for previews (no external assets; the logo is
 * embedded). Wording mirrors lib/platform/build-issues.ts in the main app.
 */
import { NYNZ_ICON_DATA_URI } from "./brand-icon.js";

const COPY: Record<string, { title: string; body: string }> = {
  SPEND_LIMIT: { title: "NYNZ is very busy right now", body: "Your app is safe. Previews are in high demand at the moment, so please reload in a few minutes." },
  TRIAL_BUDGET: { title: "Free trial previews are paused for today", body: "Free trials share a daily allowance, and today's is used up. Your app is safe. Previews reopen tomorrow, or choose a plan in NYNZ to continue now." },
  INSUFFICIENT_CREDITS: { title: "Not enough credits to wake this preview", body: "Waking a preview uses a few credits for cloud time. Add credits from Plan and billing in NYNZ, then reload." },
  NO_PREVIEW: { title: "This app isn't running right now", body: "Open the project in NYNZ and press Restart preview to start it again." },
  AUTH: { title: "Open this preview from NYNZ", body: "For your privacy, previews only open from your NYNZ project. Go back to the project and open the preview again." },
  FORBIDDEN: { title: "This preview belongs to another account", body: "Sign in to NYNZ with the account that owns this project." },
  DEFAULT: { title: "Preview couldn't load", body: "The preview didn't respond. Reload in a moment, or restart the preview from your NYNZ project." },
};

export function previewErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("TRIAL_BUDGET") ? "TRIAL_BUDGET" : message.includes("SPEND_LIMIT") ? "SPEND_LIMIT" : message.includes("INSUFFICIENT_CREDITS") ? "INSUFFICIENT_CREDITS" : "DEFAULT";
}

export function codeForStatus(status: number) {
  return status === 401 ? "AUTH" : status === 403 ? "FORBIDDEN" : status === 409 ? "NO_PREVIEW" : "DEFAULT";
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function previewErrorPage(code: string, appOrigin: string) {
  const { title, body } = COPY[code] || COPY.DEFAULT;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b12;color:#f4f1e8;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
.card{max-width:420px;width:100%;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:#0e1520;padding:28px;text-align:center}
.mark{display:block;width:48px;height:48px;margin:0 auto 18px;border-radius:12px}
h1{font-size:18px;margin:0 0 8px;font-weight:600;letter-spacing:-.01em}p{margin:0;color:rgba(244,241,232,.65);font-size:14px}
.actions{margin-top:20px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
a,button{font:inherit;font-size:13px;border-radius:10px;padding:8px 14px;text-decoration:none;cursor:pointer}
.primary{background:#c7ff4a;color:#071019;border:0;font-weight:600}.ghost{background:transparent;color:rgba(244,241,232,.8);border:1px solid rgba(255,255,255,.15)}
@media (prefers-reduced-motion:no-preference){.card{animation:in .5s cubic-bezier(.2,.7,.2,1) both}@keyframes in{from{opacity:0;transform:translateY(10px)}}}
</style></head><body><main class="card" role="status"><img class="mark" src="${NYNZ_ICON_DATA_URI}" alt="NYNZ" width="48" height="48"><h1>${escape(title)}</h1><p>${escape(body)}</p>
<div class="actions"><a class="primary" href="" onclick="location.reload();return false">Reload</a><a class="ghost" href="${escape(appOrigin)}/dashboard" target="_top" rel="noopener">Open NYNZ</a></div></main></body></html>`;
}
