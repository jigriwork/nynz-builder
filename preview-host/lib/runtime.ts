/** Shared by the standalone preview host, local gateway and terminal API. */
export function runtimeAdmissionArgs(sandboxId: string, projectId: string, userId: string, seconds: number, env: Record<string, string | undefined> = process.env) {
  const rate = Number(env.USD_TO_INR_RATE || 95);
  const perSecond = Number(env.E2B_COST_USD_PER_SECOND || 0.000046);
  const perCredit = Number(env.PAISE_PER_CREDIT || 100);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600 || !Number.isInteger(perCredit) || ![rate, perSecond, perCredit].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Invalid runtime accounting configuration");
  const estimate = Math.max(1, Math.ceil(2 * seconds * perSecond * rate * 100));
  return { p_project: projectId, p_user: userId, p_sandbox: sandboxId, p_seconds: seconds, p_estimate: estimate, p_credits: Math.ceil(estimate / perCredit), p_paise_per_credit: perCredit };
}

/**
 * Arguments for extend_sandbox_session: called before a visit extends a
 * sandbox's runtime, so the extension is held before it happens. Charges are
 * settled later against the recorded running time, once per session.
 */
/** The extension result the host keeps until the sandbox has been reached. */
export type SessionVisit = { session?: string; opened?: boolean; visit_at?: string } | null | undefined;

/** Arguments for abandon_sandbox_visit when the visit that opened a segment could not reach the sandbox. */
export function abandonVisitArgs(visit: SessionVisit) {
  return visit?.opened && visit.session && visit.visit_at ? { p_session: visit.session, p_visit: visit.visit_at } : null;
}

export function sessionExtensionArgs(sandboxId: string, projectId: string, userId: string, seconds: number, env: Record<string, string | undefined> = process.env) {
  const rate = Number(env.USD_TO_INR_RATE || 95);
  const perSecond = Number(env.E2B_COST_USD_PER_SECOND || 0.000046);
  const perCredit = Number(env.PAISE_PER_CREDIT || 100);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600 || !Number.isInteger(perCredit) || ![rate, perSecond, perCredit].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Invalid runtime accounting configuration");
  return { p_project: projectId, p_user: userId, p_sandbox: sandboxId, p_timeout: seconds, p_pps: perSecond * rate * 100, p_ppc: perCredit };
}
