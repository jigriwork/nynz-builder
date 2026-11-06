import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InviteOnlyPanel } from "../../components/auth/invite-only-panel";

describe("invite-only signup panel", () => {
  it("thanks the visitor, explains the testing phase and asks for an email", () => {
    const html = renderToStaticMarkup(createElement(InviteOnlyPanel, { onSignIn: () => undefined }));
    expect(html).toContain("Thank you for wanting to join NYNZ.");
    expect(html).toContain("private testing phase");
    expect(html).toContain("onboarding soon");
    expect(html).toContain("Request an invite");
    expect(html).toContain('type="email"');
    expect(html).not.toContain("password");
  });
});
