import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BudgetError } from "./budget-error";
import { actualModelCallPaise, creditsForPaise, sandboxSecondsPaise, paisePerCredit, usdToInrRate } from "./pricing";

type Job = { id: string; requested_by: string; project_id: string };
type Pending = { spendId: number | null; eventKey: string; model: string };

/**
 * Per-build metering. Before each paid provider call it (1) extends the
 * customer's reservation to cover the worst-case cost and (2) authorises the
 * spend against platform-wide caps; either failure stops the call before it is
 * sent. After the call it records provider usage, settles the actual cost and
 * consumes credits with an idempotent event key. Builds without a customer
 * reservation (for example staff-initiated restarts) are still capped and
 * recorded; their cost is absorbed by NYNZ and labelled as such.
 */
export class BuildMeter {
  private pending: Pending[] = [];
  private sandboxSpend: { id: number; seconds: number } | null = null;
  private step: string | null = null;
  /** Labels the following charges in the credit history (for example "Writing Orders.tsx"). */
  setStep(label: string | null) { this.step = label ? label.slice(0, 120) : null; }
  constructor(private readonly db: SupabaseClient, private readonly job: Job, private readonly env: Record<string, string | undefined> = process.env) {}

  private async hasReservation() {
    const { data, error } = await this.db.from("credit_reservations").select("id,status").eq("build_id", this.job.id).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async beforeModelCall(event: { models: string[]; estimatedPaise: number }) {
    const credits = creditsForPaise(event.estimatedPaise, this.env);
    if (await this.hasReservation()) {
      const { data, error } = await this.db.rpc("ensure_reservation_headroom", { p_build: this.job.id, p_needed: credits });
      if (error) throw error;
      if (!data) throw new BudgetError("INSUFFICIENT_CREDITS", "The account does not have enough credits for the next generation step.");
    }
    const eventKey = `model:${this.job.id}:${randomUUID()}`;
    const { data: spendId, error } = await this.db.rpc("authorize_provider_spend", {
      p_provider: "openrouter", p_kind: "model", p_model: event.models[0], p_estimate: event.estimatedPaise,
      p_build: this.job.id, p_user: this.job.requested_by, p_event_key: eventKey,
    });
    if (error) {
      if (/SPEND_LIMIT/.test(error.message)) throw new BudgetError("SPEND_LIMIT", "A platform spending limit was reached.");
      throw error;
    }
    this.pending.push({ spendId: Number(spendId), eventKey, model: event.models[0] });
  }

  async afterModelCall(event: { prompt_tokens: number; completion_tokens: number; costUsd: number; model: string; requestId: string | null; providerCostReported?: boolean }) {
    // Failed/aborted requests retain their conservative authorised hold. The
    // latest request, not an earlier failed attempt, owns this response.
    const call = this.pending.pop();
    const cost = actualModelCallPaise({ model: event.model, inputTokens: event.prompt_tokens, outputTokens: event.completion_tokens, providerCostUsd: event.providerCostReported === false ? undefined : event.costUsd }, this.env);
    const eventKey = event.requestId ? `openrouter:${event.requestId}` : call?.eventKey || `model:${this.job.id}:${randomUUID()}`;
    const costMetadata = { cost_currency: "INR", cost_source: cost.source, event_key: eventKey, provider_cost_usd: event.providerCostReported === false ? null : event.costUsd, usd_to_inr_rate: usdToInrRate(this.env) };
    const base = { owner_id: this.job.requested_by, project_id: this.job.project_id, build_id: this.job.id, provider: "openrouter", model: event.model, provider_request_id: event.requestId };
    const usage = await this.db.from("usage_events").insert([
      { ...base, kind: "model_input_tokens", quantity: event.prompt_tokens, metadata: costMetadata },
      { ...base, kind: "model_output_tokens", quantity: event.completion_tokens, estimated_cost_minor: cost.paise, metadata: costMetadata },
    ]);
    if (usage.error) console.error(`[meter] usage recording failed for build ${this.job.id}`);
    if (call?.spendId) {
      const settled = await this.db.rpc("settle_provider_spend", { p_id: call.spendId, p_actual: cost.paise, p_source: cost.source });
      if (settled.error) throw settled.error;
    }
    if (await this.hasReservation()) {
      const { error } = await this.db.rpc("consume_credits", {
        p_build: this.job.id, p_amount: creditsForPaise(cost.paise, this.env), p_event_key: eventKey, p_provider: "openrouter", p_model: event.model,
        p_cost_paise: cost.paise, p_cost_source: cost.source, p_metadata: { input_tokens: event.prompt_tokens, output_tokens: event.completion_tokens, provider_spend_id: call?.spendId, paise_per_credit: paisePerCredit(this.env), ...(this.step ? { step: this.step } : {}) },
      });
      if (error) throw error;
    }
  }

  /** Reserve both customer allowance and the shared provider budget before allocation. */
  async beforeSandbox(seconds: number) {
    const estimate = sandboxSecondsPaise(seconds, this.env);
    if (await this.hasReservation()) {
      const held = await this.db.rpc("ensure_reservation_headroom", { p_build: this.job.id, p_needed: creditsForPaise(estimate, this.env) });
      if (held.error) throw held.error;
      if (!held.data) throw new BudgetError("INSUFFICIENT_CREDITS", "Not enough credits to start a preview.");
    }
    const allowed = await this.db.rpc("authorize_provider_spend", { p_provider: "e2b", p_kind: "sandbox", p_model: null, p_estimate: estimate, p_build: this.job.id, p_user: this.job.requested_by, p_event_key: `e2b:${this.job.id}:${randomUUID()}:allocation` });
    if (allowed.error) {
      if (/SPEND_LIMIT/.test(allowed.error.message)) throw new BudgetError("SPEND_LIMIT", "A platform spending limit was reached.");
      throw allowed.error;
    }
    this.sandboxSpend = { id: Number(allowed.data), seconds };
  }

  /** Sandbox time is billed by E2B per second; NYNZ records an estimate. */
  async recordSandbox(sandboxId: string, seconds: number, outcome: string) {
    if (seconds <= 0) return;
    // Keep the full allocated lifetime counted for a preview still running or
    // whose termination is uncertain. Releasing it at build completion would
    // let unmetered idle runtime exceed a combined verification cap.
    const budgetSeconds = Math.max(seconds, this.sandboxSpend?.seconds || 0);
    const paise = sandboxSecondsPaise(budgetSeconds, this.env);
    const eventKey = `e2b:${sandboxId}:build`;
    await this.db.from("usage_events").insert({ owner_id: this.job.requested_by, project_id: this.job.project_id, build_id: this.job.id, kind: "sandbox_seconds", quantity: seconds, provider: "e2b", estimated_cost_minor: paise, metadata: { outcome, cost_source: "estimate", event_key: eventKey } });
    const recorded = this.sandboxSpend
      ? await this.db.rpc("settle_provider_spend", { p_id: this.sandboxSpend.id, p_actual: paise, p_source: "allocated_runtime_estimate" })
      : await this.db.rpc("record_provider_spend", { p_provider: "e2b", p_kind: "sandbox", p_model: null, p_actual: paise, p_source: "estimate", p_build: this.job.id, p_user: this.job.requested_by, p_event_key: eventKey });
    if (recorded.error) throw recorded.error;
    if (await this.hasReservation()) {
      const consumed = await this.db.rpc("consume_credits", { p_build: this.job.id, p_amount: creditsForPaise(paise, this.env), p_event_key: eventKey, p_provider: "e2b", p_model: null, p_cost_paise: paise, p_cost_source: "allocated_runtime_estimate", p_metadata: { seconds, allocated_seconds: budgetSeconds, outcome, provider_spend_id: this.sandboxSpend?.id, paise_per_credit: paisePerCredit(this.env), provisional: true, step: outcome === "publish" ? "Publishing build" : "Preview environment (build and checks)" } });
      if (consumed.error) throw consumed.error;
    }
  }

  /** Releases whatever was reserved but not used. Safe to call repeatedly. */
  async settle(reason: string) {
    const settled = await this.db.rpc("settle_reservation", { p_build: this.job.id, p_reason: reason });
    if (settled.error) throw settled.error;
    return (settled.data || {}) as { settled?: boolean; consumed?: number; released?: number };
  }
}
