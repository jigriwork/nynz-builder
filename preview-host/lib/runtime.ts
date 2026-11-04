/** Shared by the standalone preview host, local gateway and terminal API. */
export function runtimeAdmissionArgs(sandboxId: string, projectId: string, userId: string, seconds: number, env: Record<string, string | undefined> = process.env) {
  const rate = Number(env.USD_TO_INR_RATE || 95);
  const perSecond = Number(env.E2B_COST_USD_PER_SECOND || 0.000028);
  const perCredit = Number(env.PAISE_PER_CREDIT || 100);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600 || ![rate, perSecond, perCredit].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Invalid runtime accounting configuration");
  const estimate = Math.max(1, Math.ceil(2 * seconds * perSecond * rate * 100));
  return { p_project: projectId, p_user: userId, p_sandbox: sandboxId, p_seconds: seconds, p_estimate: estimate, p_credits: Math.ceil(estimate / perCredit) };
}
