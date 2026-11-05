import { describe, expect, it } from "vitest";
import { describeTrialReopen, trialPausedMessage, trialReopensAt } from "../../lib/billing/trial";

describe("trial pause timing", () => {
  it("reopens at the next midnight India time, the boundary the trial allowance uses", () => {
    // 22:10 IST on 5 Nov is 16:40 UTC; it reopens at 00:00 IST on 6 Nov (18:30 UTC on 5 Nov).
    expect(trialReopensAt(new Date("2026-11-05T16:40:00Z")).toISOString()).toBe("2026-11-05T18:30:00.000Z");
    // 00:05 IST on 6 Nov (18:35 UTC on 5 Nov) reopens at the following midnight.
    expect(trialReopensAt(new Date("2026-11-05T18:35:00Z")).toISOString()).toBe("2026-11-06T18:30:00.000Z");
  });

  it("tells the customer when they can try again and that the project is safe", () => {
    const now = new Date("2026-11-05T16:40:00Z");
    expect(describeTrialReopen(trialReopensAt(now), now)).toBe("12:00 am India time on Fri, 6 Nov (in about 2 hours)");
    const message = trialPausedMessage(now);
    expect(message).toContain("paused until 12:00 am India time on Fri, 6 Nov");
    expect(message).toContain("Your projects are safe");
    expect(message).not.toMatch(/plan/i);
  });
});

describe("trial pause card", () => {
  it("shows Choose a plan only when checkout is available", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { TrialPauseCard } = await import("../../components/trial-pause-card");
    const retryAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const render = (checkoutAvailable: boolean) => renderToStaticMarkup(createElement(TrialPauseCard, { pause: { retryAt, checkoutAvailable }, onReopen: () => undefined }));
    expect(render(true)).toContain("Choose a plan");
    expect(render(false)).not.toContain("Choose a plan");
    expect(render(false)).toContain("Your project and its files are safe");
    expect(render(false)).toContain("12:00 am India time");
  });
});
