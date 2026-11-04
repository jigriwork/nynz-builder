import type { Metadata } from "next";

/** Text used for search results and link previews (WhatsApp, X, LinkedIn, iMessage, Slack). */
export const SITE_TITLE = "NYNZ: AI app builder for real web apps";
export const SHARE_TITLE = "NYNZ: Your idea. A working app.";
export const SITE_DESCRIPTION = "Describe your app in plain words. NYNZ plans it, writes real React code and runs it live in minutes. Edit by chatting and export the code anytime. Made in India.";

/**
 * Metadata for a public page. Next replaces a parent's openGraph and twitter
 * objects instead of merging them, so every page restates the shared fields
 * here; otherwise a shared link shows the homepage title and address.
 */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const full = `${title} · NYNZ`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "NYNZ", locale: "en_IN", url: path, title: full, description },
    twitter: { card: "summary_large_image", title: full, description },
  };
}
