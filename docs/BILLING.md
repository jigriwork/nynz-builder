# Plans, credits and payments

## Plans (database: `public.plans`, versioned)

| Plan | Price excl. GST | Charged at 18% GST | Credits / month | Builds at once | Projects |
|---|---|---|---|---|---|
| Free | ₹0 | ₹0 | trial grant only | 1 | 3 |
| Starter | ₹999 | ₹1,178.82 | 400 | 1 | 10 |
| Pro | ₹1,499 | ₹1,768.82 | 650 | 2 | 30 |

Money is stored in paise. Each payment records the gross amount charged, the
tax portion and the revenue excluding tax separately (`payments.amount_minor`,
`tax_minor`, `net_minor`). Changing a price creates a new plan version;
subscribers keep the version they bought.

## Credits

- 1 credit = ₹1.00 of measured provider cost (`PAISE_PER_CREDIT=100`).
- Model calls are charged from OpenRouter's provider-reported cost when it is
  returned, otherwise from a dated per-model price table (input and output
  tokens priced separately; unknown models priced conservatively). E2B sandbox
  time and Firecrawl pages are charged at labelled estimates.
- Work reserves credits before it starts; every provider call first checks the
  reservation can absorb its worst case and that platform spend caps allow it.
  Unused holds are released when the build ends, fails, is cancelled or is
  recovered. Late or duplicate provider events are deduplicated.
- If an actual cost exceeds what the customer has left, the remainder is
  absorbed by NYNZ and recorded as `overrun_absorbed`; balances never go
  negative.
- New accounts receive one expiring trial grant (`TRIAL_CREDITS`, default 25,
  30 days). Historical usage before release 0.3 was not converted into credits.

## Allowance assumptions (not profit claims)

Measured so far (audit, 4 Nov 2026, development-era runs): 48 OpenRouter calls
cost ₹156.61 in provider-reported cost across 46 jobs, roughly ₹3–7 per
successful build depending on size. With 400 credits, Starter caps a
customer's metered provider spend at about 40% of its ex-GST price; Pro at
about 43%. The remainder must cover payment fees, unmetered E2B idle/resume
time, hosting, database, support and tax obligations, which are not yet fully
measured. Treat these allowances as provisional until a month of real paid
usage has been reconciled against provider invoices and recorded expenses.

## Subscription lifecycle (Razorpay)

- Checkout creates a Razorpay subscription and a local `created` record. The
  browser callback only verifies the checkout signature; it never activates.
- Status changes come only from signed webhooks (or Admin → Reconcile with
  Razorpay, which applies the provider's own state through the same path).
- `subscription.charged` grants that period's credits once per paid period.
- Failed renewal (`pending`): plan access continues for a 3-day grace period
  after the period end while Razorpay retries. `halted`: access returns to Free;
  credits already granted remain until they expire.
- Cancellation is at period end; access continues until then.
- Plan changes are scheduled for the next billing cycle (`schedule_change_at:
  cycle_end`) and applied when Razorpay reports them. No mid-cycle proration.
- Top-ups (inactive until the owner sets a price) grant purchased credits valid
  for 12 months after `payment.captured`/`order.paid` with a matching amount.
- Refunds are requested by staff with `billing.refund`, sent to Razorpay, and
  marked processed by the `refund.processed` webhook. Unused credits bought with
  that payment can be reversed.

## Configuration

Webhook URL: `https://www.nynz.in/api/webhooks/razorpay`. Subscribe to:
`subscription.authenticated`, `subscription.activated`, `subscription.charged`,
`subscription.pending`, `subscription.halted`, `subscription.cancelled`,
`subscription.completed`, `subscription.paused`, `subscription.resumed`,
`subscription.updated`, `payment.captured`, `payment.failed`, `order.paid`,
`refund.processed`.

Use test keys only. Live keys (`rzp_live_`) are refused unless
`BILLING_LIVE_ENABLED=true`, which should be set only after merchant
activation, the legal entity, GSTIN and invoice details are confirmed. NYNZ does
not generate GST tax invoices yet and never invents a GSTIN.
