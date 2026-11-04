import { z } from "zod";
import { json, requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { requirePayments } from "@/lib/billing/session";
import { grossWithTax } from "@/lib/billing/razorpay";

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = z.object({ pack: z.string().regex(/^[a-z0-9_]{2,40}$/) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Choose a credit pack");
  const limited = await rateLimit(`topup:${auth.user.id}`, 10, 3600);
  if (limited) return limited;
  const payments = requirePayments();
  if ("error" in payments) return payments.error;
  const admin = createAdmin();
  const { data: pack } = await admin.from("topup_packs").select("*").eq("code", parsed.data.pack).eq("active", true).maybeSingle();
  if (!pack) return apiError("NOT_FOUND", "That credit pack is not available");
  try {
    const amount = grossWithTax(Number(pack.price_minor), pack.tax_rate_bps);
    const order = await payments.client.createOrder({ amountMinor: amount, receipt: `topup-${crypto.randomUUID().slice(0, 20)}`, notes: { nynz_kind: "topup", nynz_user: auth.user.id, nynz_pack: pack.code } });
    const { error } = await admin.rpc("create_topup_order", { p_user: auth.user.id, p_pack: pack.code, p_provider_order_id: order.id });
    if (error) throw error;
    return json({ keyId: payments.config.keyId, orderId: order.id, amount, mode: payments.config.mode, email: auth.user.email });
  } catch (error) {
    return apiError("SERVICE_UNAVAILABLE", "Checkout could not be started. No charge was made.", { cause: error, scope: "topup" });
  }
}
