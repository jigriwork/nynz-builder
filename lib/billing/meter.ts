import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BudgetError } from "./budget-error";
import { actualModelCallPaise, creditsForPaise, sandboxSecondsPaise } from "./pricing";

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
  constructor(private readonly db: SupabaseClient, private readonly job: Job, private readonly env: Record<string, string | undefined> = process.env) {}

  private async hasReservation() {
    const { data } = await this.db.from("credit_reservations").select("id,status").eq("build_id", this.job.id).maybeSingle();
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

  async afterModelCall(event: { prompt_tokens: number; completion_tokens: number; costUsd: number; model: string; requestId: string | null }) {
    const call = this.pending.shift();
    const cost = actualModelCallPaise({ model: event.model, inputTokens: event.prompt_tokens, outputTokens: event.completion_tokens, providerCostUsd: event.costUsd }, this.env);
    const eventKey = event.requestId ? `openrouter:${event.requestId}` : call?.eventKey || `model:${this.job.id}:${randomUUID()}`;
    const base = { owner_id: this.job.requested_by, project_id: this.job.project_id, build_id: this.job.id, provider: "openrouter", model: event.model, provider_request_id: event.requestId };
    const usage = await this.db.from("usage_events").insert([
      { ...base, kind: "model_input_tokens", quantity: event.prompt_tokens, metadata: { cost_currency: "INR", cost_source: cost.source, event_key: eventKey } },
      { ...base, kind: "model_output_tokens", quantity: event.completion_tokens, estimated_cost_minor: cost.paise || null, metadata: { cost_currency: "INR", cost_source: cost.source, event_key: eventKey } },
    ]);
    if (usage.error) console.error(`[meter] usage recording failed for build ${this.job.id}`);
    if (call?.spendId) await this.db.rpc("settle_provider_spend", { p_id: call.spendId, p_actual: cost.paise, p_source: cost.source });
    if (await this.hasReservation()) {
      const { error } = await this.db.rpc("consume_credits", {
        p_build: this.job.id, p_amount: creditsForPaise(cost.paise, this.env), p_event_key: eventKey, p_provider: "openrouter", p_model: event.model,
        p_cost_paise: cost.paise, p_cost_source: cost.source, p_metadata: { input_tokens: event.prompt_tokens, output_tokens: event.completion_tokens },
      });
      if (error) console.error(`[meter] credit consumption failed for build ${this.job.id}: ${error.message}`);
    }
  }

  /** Sandbox time is billed by E2B per second; NYNZ records an estimate. */
  async recordSandbox(sandboxId: string, seconds: number, outcome: string) {
    if (seconds <= 0) return;
    const paise = sandboxSecondsPaise(seconds, this.env);
    const eventKey = `e2b:${sandboxId}:build`;
    await this.db.from("usage_events").insert({ owner_id: this.job.requested_by, project_id: this.job.project_id, build_id: this.job.id, kind: "sandbox_seconds", quantity: seconds, provider: "e2b", estimated_cost_minor: paise, metadata: { outcome, cost_source: "estimate", event_key: eventKey } });
    await this.db.rpc("record_provider_spend", { p_provider: "e2b", p_kind: "sandbox", p_model: null, p_actual: paise, p_source: "estimate", p_build: this.job.id, p_user: this.job.requested_by, p_event_key: eventKey });
    if (await this.hasReservation()) {
      await this.db.rpc("consume_credits", { p_build: this.job.id, p_amount: creditsForPaise(paise, this.env), p_event_key: eventKey, p_provider: "e2b", p_model: null, p_cost_paise: paise, p_cost_source: "estimate", p_metadata: { seconds, outcome } });
    }
  }

  /** Releases whatever was reserved but not used. Safe to call repeatedly. */
  async settle(reason: string) {
    await this.db.rpc("settle_reservation", { p_build: this.job.id, p_reason: reason });
  }
}
