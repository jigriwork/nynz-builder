import { describe, expect, it } from "vitest";
import { classifyPlatformQuestion } from "../../lib/platform/platform-questions";

const APPROVED = "NYNZ was founded by Adib Sattar from Berhampur, Odisha, India.";
const kind = (text: string) => classifyPlatformQuestion(text)?.kind ?? null;

describe("NYNZ identity questions in chat", () => {
  it.each(["Who founded NYNZ?", "Who is your founder?", "Who created you?", "Who made this platform?", "who built nynz", "Who's behind NYNZ?", "Who owns NYNZ?", "who is the founder of nynz"])("answers %s with the approved fact", (text) => {
    expect(classifyPlatformQuestion(text)).toEqual({ kind: "founder", language: "en", reply: APPROVED });
  });

  it.each([["Tumhara founder kaun hai?", "hinglish"], ["NYNZ ka founder kaun hai", "hinglish"], ["Aapko kisne banaya?", "hinglish"], ["आपको किसने बनाया?", "hi"], ["NYNZ का संस्थापक कौन है?", "hi"]])("matches the language of %s", (text, language) => {
    const answer = classifyPlatformQuestion(text);
    expect(answer?.kind).toBe("founder");
    expect(answer?.language).toBe(language);
    expect(answer?.reply).toMatch(/Adib Sattar|अदीब सत्तार/);
    expect(answer?.reply).toMatch(/Berhampur|बरहामपुर/);
  });

  it.each(["Change my app's founder name to Rahul", "Create a founder profile page", "Add a founder section to the about page", "Build a page about who founded our bakery", "Who founded the company shown in my app's about section?", "Make the header bigger", "Did you make this app?", "Who are you?", "Set the footer text to: Made by Rahul, founder of Kiro", "Show the founder's photo on the team page", ""])("leaves %s to the normal build flow", (text) => {
    expect(kind(text)).toBeNull();
  });

  it("distinguishes the AI model's creators from NYNZ's founder", () => {
    const answer = classifyPlatformQuestion("Who created the AI model you use?");
    expect(answer?.kind).toBe("model");
    expect(answer?.reply).toMatch(/created by their own providers/);
    expect(answer?.reply).not.toMatch(/Adib Sattar (created|built|made) the (AI )?model/i);
  });

  it("asks for clarification instead of dropping an app change in a mixed message", () => {
    const answer = classifyPlatformQuestion("Who founded NYNZ? Also change the header colour to blue.");
    expect(answer?.kind).toBe("clarify");
    expect(answer?.reply).toContain(APPROVED);
    expect(answer?.reply).toMatch(/haven't made/);
  });

  it("never adds embellishments to the approved facts", () => {
    for (const text of ["Who founded NYNZ?", "Tumhara founder kaun hai?", "आपको किसने बनाया?"]) {
      expect(classifyPlatformQuestion(text)!.reply).not.toMatch(/first|award|funded|investor|degree|CEO|IIT|startup of the year/i);
    }
  });
});
