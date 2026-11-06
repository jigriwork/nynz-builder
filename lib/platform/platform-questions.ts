/**
 * Narrow detection of questions about NYNZ itself (who founded or created the
 * platform, or who made the AI models it uses), answered deterministically in
 * the existing project chat without queuing a build, touching files or using
 * credits. Anything that asks to change or build app content goes to the
 * normal build flow. Mixed messages get a clarification instead of silently
 * dropping the app instruction.
 *
 * Approved fact (do not embellish): NYNZ was founded by Adib Sattar from
 * Berhampur, Odisha, India.
 */
export type PlatformAnswer = { kind: "founder" | "model" | "clarify"; language: "en" | "hinglish" | "hi"; reply: string };
export type CasualAnswer = { kind: "greeting" | "thanks" | "acknowledgement" | "help" | "identity"; language: "en"; reply: string };

const SUBJECT = /\b(nynz|you|your|yourself|this (?:platform|app builder|builder|website|site|tool|product|service|company)|tum(?:ne|hara|hari|he|ko)?|aap(?:ne|ka|ki|ko)?|is (?:platform|app|website|site|tool) (?:ko|ka|ki))\b|आप(?:ने|का|को)?|तुम(?:ने|्हारा|्हें)?|यह प्लेटफ़ॉर्म|ये प्लेटफॉर्म/i;
const CREATOR = /\b(found(?:ed|er|ers)?|creat(?:ed|or|ors)|made|make|built|build|develop(?:ed|er)|started|owner|owns|behind|banaya|banai|banaayi|banaaya|malik|sansthapak)\b|संस्थापक|बनाया|बनाई|मालिक|founder/i;
// Only "who" questions: "Did you make this app?" is about the user's app, not NYNZ.
const QUESTION = /^\s*(?:and |so |hey |hi |ok |okay )?(who|whose|who's|tell me who)\b|\b(kaun|kisne|kis ne)\b|कौन|किसने/i;
const MODEL = /\b(ai|llm|language model|model|models|gpt|claude|gemini|anthropic|openai)\b/i;
// Requests to change or build app content, which must reach the build flow.
const APP_WORK = /\b(change|update|edit|rename|replace|set|add|remove|delete|create|build|make|design|generate|put|show|display|write|insert|fix|move)\b[^?.!]*\b(page|section|screen|app|site|header|footer|profile|name|text|button|title|component|card|field|form|founder name|about)\b|\b(my|our) (app|site|website|page|project)\b|\b(meri|mera|hamari|hamara) (app|website|site)\b/i;

function language(text: string): PlatformAnswer["language"] {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/\b(kaun|kisne|tumhara|tumhari|aapka|aapki|banaya|banai|hai|hain|kya|batao|bataiye)\b/i.test(text)) return "hinglish";
  return "en";
}

const FOUNDER = {
  en: "NYNZ was founded by Adib Sattar from Berhampur, Odisha, India.",
  hinglish: "NYNZ ke founder Adib Sattar hain, jo Berhampur, Odisha, India se hain.",
  hi: "NYNZ की स्थापना बरहामपुर, ओडिशा, भारत के अदीब सत्तार ने की है।",
};
const MODEL_ANSWER = {
  en: "The AI models NYNZ uses to plan and write code are created by their own providers (currently Anthropic and Google, accessed through OpenRouter), not by NYNZ. NYNZ, the app-building platform around them, was founded by Adib Sattar from Berhampur, Odisha, India.",
  hinglish: "NYNZ jo AI models use karta hai, woh unke apne providers ne banaye hain (abhi Anthropic aur Google, OpenRouter ke through), NYNZ ne nahi. NYNZ platform ke founder Adib Sattar hain, jo Berhampur, Odisha, India se hain.",
  hi: "NYNZ जिन AI मॉडलों का उपयोग करता है, वे उनके अपने प्रदाताओं ने बनाए हैं (अभी Anthropic और Google, OpenRouter के माध्यम से), NYNZ ने नहीं। NYNZ प्लेटफ़ॉर्म की स्थापना बरहामपुर, ओडिशा, भारत के अदीब सत्तार ने की है।",
};
const CLARIFY = {
  en: "NYNZ was founded by Adib Sattar from Berhampur, Odisha, India. Your message also seems to ask for a change to your app, which I haven't made. Send that change as its own message and I'll plan it for you.",
  hinglish: "NYNZ ke founder Adib Sattar hain, jo Berhampur, Odisha, India se hain. Aapke message mein app mein badlaav ki baat bhi lagti hai, jo maine abhi nahi kiya. Woh badlaav alag message mein bhejiye, main uska plan bana dunga.",
  hi: "NYNZ की स्थापना बरहामपुर, ओडिशा, भारत के अदीब सत्तार ने की है। आपके संदेश में ऐप में बदलाव की बात भी लगती है, जो मैंने अभी नहीं किया है। वह बदलाव अलग संदेश में भेजिए, मैं उसकी योजना बना दूँगा।",
};

/** Returns an answer only for a clear question about NYNZ's own founder/creator or its AI models. */
export function classifyPlatformQuestion(raw: string): PlatformAnswer | null {
  const text = raw.trim();
  if (!text || text.length > 400) return null;
  const sentences = text.split(/(?<=[?.!।])\s+/).filter(Boolean);
  const about = sentences.find((s) => CREATOR.test(s) && QUESTION.test(s) && (SUBJECT.test(s) || /\bthe (ai )?models? you use\b/i.test(s)));
  if (!about) return null;
  const lang = language(text);
  const rest = sentences.filter((s) => s !== about).join(" ");
  // The question sentence itself asks for app work ("Who made my app's header?") → not about NYNZ.
  if (APP_WORK.test(about) && !/\b(nynz|you|your|tum|aap)\b/i.test(about.replace(APP_WORK, ""))) return null;
  if (rest && APP_WORK.test(rest)) return { kind: "clarify", language: lang, reply: CLARIFY[lang] };
  if (MODEL.test(about) && !/\bnynz\b/i.test(about.replace(MODEL, "")) ) return { kind: "model", language: lang, reply: MODEL_ANSWER[lang] };
  return { kind: "founder", language: lang, reply: FOUNDER[lang] };
}

/**
 * Handles short conversation turns without reserving credits or starting a
 * plan. This is deliberately conservative: any appended app instruction falls
 * through to the build flow instead of being swallowed as small talk.
 */
export function classifyCasualMessage(raw: string): CasualAnswer | null {
  const text = raw.trim().replace(/[.!?]+$/g, "").trim();
  if (!text || text.length > 100) return null;
  if (/^(?:hi|hello|hey|hiya|hi there|hello there|hey there|namaste|good (?:morning|afternoon|evening))(?: nynz)?$/i.test(text)) {
    return { kind: "greeting", language: "en", reply: "Hi! Tell me what you'd like to change in this project, or attach a catalog and describe what you want me to use from it." };
  }
  if (/^(?:how are you|how's it going|hows it going|what's up|whats up)$/i.test(text)) {
    return { kind: "greeting", language: "en", reply: "I'm ready to help with your project. What would you like to work on?" };
  }
  if (/^(?:who are you|what are you)$/i.test(text)) {
    return { kind: "identity", language: "en", reply: "I'm NYNZ, your project-building assistant. I can discuss the project without starting a build, and I will show you a plan before making requested changes." };
  }
  if (/^(?:thanks|thank you|thank you so much|thanks a lot|thx)$/i.test(text)) {
    return { kind: "thanks", language: "en", reply: "You're welcome. I'm ready when you want to continue." };
  }
  if (/^(?:ok|okay|got it|understood|cool|great|sounds good|alright|bye|goodbye|see you)$/i.test(text)) {
    return { kind: "acknowledgement", language: "en", reply: "Got it. Send the next change whenever you're ready." };
  }
  if (/^(?:help|what can you do|how can you help|how does this work)$/i.test(text)) {
    return { kind: "help", language: "en", reply: "I can plan and build changes to this project, use uploaded images and catalog content, and explain NYNZ. Describe the result you want; I will show a plan before changing code." };
  }
  return null;
}

/** A message that can be answered without creating a build job. */
export function classifyConversationMessage(raw: string): PlatformAnswer | CasualAnswer | null {
  return classifyPlatformQuestion(raw) || classifyCasualMessage(raw);
}
