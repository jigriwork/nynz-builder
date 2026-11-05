/** Raised when paid work must stop before (or instead of) calling a provider. */
export class BudgetError extends Error {
  constructor(public readonly code: "INSUFFICIENT_CREDITS" | "SPEND_LIMIT" | "TRIAL_BUDGET" | "BUILD_LIMIT" | "CONCURRENCY_LIMIT", message: string) {
    super(message);
    this.name = "BudgetError";
  }
}
