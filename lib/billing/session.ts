import { razorpayConfig, RazorpayClient } from "./razorpay";
import { apiError } from "@/lib/http/errors";

export function requirePayments() {
  const config = razorpayConfig();
  if (!config) return { error: apiError("SERVICE_UNAVAILABLE", "Payments are not available yet. No charge was made.") } as const;
  return { config, client: new RazorpayClient(config) } as const;
}
