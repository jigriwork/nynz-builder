type SourceFile = { path: string; content: string };
const GENERIC = /^(?:application|my app|vite(?: \+ react)?|react(?:[- +]ts)?[- +]vite|nynz-app)$/i;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Complete new-app metadata locally; never edit existing customer source. */
export function completeApplicationIdentity(input: SourceFile[], fallback: string) {
  const files = input.map((file) => ({ ...file }));
  const html = files.find((file) => file.path === "index.html");
  const pkg = files.find((file) => file.path === "package.json");
  if (!html || !pkg) throw new Error("Generated application is missing identity files");
  const title = html.content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const heading = files.filter((file) => /\.[jt]sx$/.test(file.path)).map((file) => file.content.match(/<h1\b[^>]*>\s*([^<{]+)\s*<\/h1>/i)?.[1]?.trim()).find(Boolean);
  const name = ((title && !GENERIC.test(title) ? title : heading || fallback).replace(/[<>]/g, "").trim().slice(0, 80)) || "Your web application";
  // Reject accidental upstream chrome instead of silently publishing it.
  if (files.some((file) => /^(?:index\.html|package\.json|src\/.*\.[jt]sx?)$/.test(file.path) && /open[\s-]?lovable|github\.com\/(?:firecrawl|mendableai)\/open-lovable|(?:made with|powered by)\s+(?:NYNZ|Lovable|Firecrawl)/i.test(file.content))) throw new Error("Generated application contains inherited platform branding");
  if (!/<head\b/i.test(html.content)) html.content = `<!doctype html><html lang="en"><head></head><body>${html.content}</body></html>`;
  if (!title || GENERIC.test(title)) {
    html.content = html.content.replace(/<title[^>]*>[\s\S]*?<\/title>/i, "");
    html.content = html.content.replace(/<\/head>/i, `<title>${escapeHtml(name)}</title></head>`);
  }
  if (!/<meta\b[^>]*name\s*=\s*["']description["']/i.test(html.content)) html.content = html.content.replace(/<\/head>/i, `<meta name="description" content="${escapeHtml(name)} — a web application."/></head>`);
  if (!/<link\b[^>]*rel\s*=\s*["'][^"']*\bicon\b/i.test(html.content)) {
    const glyph = escapeHtml(name[0].toUpperCase());
    const icon = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#172033"/><text x="32" y="45" text-anchor="middle" font-family="sans-serif" font-size="40" fill="white">${glyph}</text></svg>`);
    html.content = html.content.replace(/<\/head>/i, `<link rel="icon" href="data:image/svg+xml,${icon}"/></head>`);
  }
  const metadata = JSON.parse(pkg.content);
  if (!metadata.name || GENERIC.test(metadata.name)) metadata.name = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "customer-application";
  pkg.content = JSON.stringify(metadata, null, 2);
  return files;
}
