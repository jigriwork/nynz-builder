import { describe, expect, it } from "vitest";
import { codeForStatus, previewErrorCode, previewErrorPage } from "../../preview-host/lib/error-page";
import { describeIssue } from "../../lib/platform/build-issues";

describe("friendly preview and build errors", () => {
  it("explains the real reason a preview could not wake", () => {
    expect(previewErrorCode(new Error("Preview runtime is unavailable or its allowance has been reached: SPEND_LIMIT"))).toBe("SPEND_LIMIT");
    expect(previewErrorCode(new Error("...: INSUFFICIENT_CREDITS"))).toBe("INSUFFICIENT_CREDITS");
    expect(previewErrorCode(new Error("Sandbox connection failed (502)"))).toBe("DEFAULT");
    expect(codeForStatus(409)).toBe("NO_PREVIEW");
    const page = previewErrorPage("INSUFFICIENT_CREDITS", "https://www.nynz.in");
    expect(page).toContain("Not enough credits to wake this preview");
    expect(page).toContain('href="https://www.nynz.in/dashboard"');
    expect(page).not.toMatch(/stack|Error:|supabase|e2b/i);
    expect(previewErrorPage("DEFAULT", 'https://x"><script>')).not.toContain('"><script>');
  });
  it("gives every recorded build failure code a plain-language title", () => {
    for (const code of ["SPEND_LIMIT", "INSUFFICIENT_CREDITS", "BUILD_VALIDATION_FAILED", "GENERATOR_UNAVAILABLE", "SOURCE_CHANGED", "WORKER_INTERRUPTED", null, "UNKNOWN_CODE"]) {
      const issue = describeIssue(code);
      expect(issue.title.length).toBeGreaterThan(10);
      expect(issue.title).not.toMatch(/error|ERROR|failed with/);
    }
    expect(describeIssue("SPEND_LIMIT").tone).toBe("paused");
    expect(describeIssue("INSUFFICIENT_CREDITS").action).toBe("billing");
  });
});
