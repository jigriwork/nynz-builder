/**
 * Local stand-in for the AI's answer to a styles request: plausible layout
 * rules for exactly the class names the request lists. Used only by tests and
 * the local browser check, to exercise the real request/response path without
 * a paid model. Real-model stylesheet quality is verified separately.
 */
export function classesFromStylesRequest(user: string) {
  const section = user.split("CLASS NAMES USED IN THE MARKUP BUT NOT STYLED:\n")[1]?.split("\n\n")[0] || "";
  return [...new Set(section.split("\n").flatMap((line) => line.split(":").slice(1).join(":").trim().split(/\s+/)).filter(Boolean))];
}

export function heuristicCss(classes: string[]) {
  const rules: string[] = [];
  const mobile: string[] = [];
  for (const name of classes) {
    const n = name.toLowerCase();
    let body = "box-sizing:border-box";
    if (/hamburger|menu-toggle|burger/.test(n)) { body = "display:none;background:transparent;border:1px solid currentColor;border-radius:10px;padding:8px 10px;cursor:pointer"; mobile.push(`.${name}{display:inline-flex}`); }
    else if (/scrim|overlay|backdrop/.test(n)) body = "position:fixed;inset:0;background:rgba(15,10,40,.35)";
    else if (/hero/.test(n) && !/copy|art|title/.test(n)) { body = "display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center;padding:56px 24px"; mobile.push(`.${name}{grid-template-columns:1fr;padding:32px 16px}`); }
    else if (/nav|bar|row|actions|cta|header|head|chips|inline|toolbar|brand|links|tabs|filters|foot/.test(n)) { body = "display:flex;align-items:center;gap:12px;flex-wrap:wrap"; if (/nav|links/.test(n)) mobile.push(`.${name}{flex-direction:column;align-items:flex-start}`); }
    else if (/grid|cards|features|list|stats|kpis|charts|previews|columns/.test(n)) { body = "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px"; }
    else if (/card|panel|form|modal|login|tile|preview|box/.test(n)) body = "background:#fffdf8;border:1px solid #e7dcc8;border-radius:14px;padding:16px";
    else if (/btn|button/.test(n)) body = "display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid #2b2350;background:#fff;cursor:pointer";
    else if (/hint|note|meta|eyebrow|lead|muted|small|caption/.test(n)) body = "color:#6b6280;font-size:.92rem";
    else if (/badge|pill|tag|status/.test(n)) body = "display:inline-block;padding:2px 10px;border-radius:999px;background:#f3e8d6;font-size:.8rem";
    else if (/page|section|main|content|wrap|container/.test(n)) body = "padding:24px;max-width:1200px;margin:0 auto";
    rules.push(`.${name}{${body}}`);
  }
  return `${rules.join("\n")}\n@media (max-width: 720px){${mobile.join("")}}`;
}
