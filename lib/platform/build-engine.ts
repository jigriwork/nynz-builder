/**
 * Pure helpers for step-by-step builds: batch sizing that fits the model's
 * output limit, recovery of complete files from a cut-off response, credit
 * estimates shown before approval, the durable project brief, and plan
 * coverage checks. No network or database access, so all of it is unit tested.
 */
import { creditsForPaise, priceFor, usdToPaise } from "../billing/pricing";

export type SourceFile = { path: string; content: string };
export type PlannedFile = { path: string; purpose: string };

/** A step NYNZ could not finish automatically. Finished steps stay saved. */
export class StepFailedError extends Error {
  constructor(readonly step: { paths: string[]; reason: string; label: string }) {
    super(`Generation incomplete: could not finish ${step.label} (${step.reason})`);
    this.name = "StepFailedError";
  }
}

/**
 * Rough output size of one generated file, in tokens. Screens and seed data
 * are the large ones; configuration and types are small. Deliberately
 * generous: a batch that is too small costs a little more input, a batch that
 * is too large is cut off and has to be repaired.
 */
export function estimateOutputTokens(file: PlannedFile) {
  const path = file.path.toLowerCase();
  const purpose = file.purpose.toLowerCase();
  if (/(^|\/)(package\.json|index\.html)$/.test(path)) return 900;
  if (/\.css$/.test(path)) return 4_000;
  if (/(types?|constants?|config)\.(ts|js)$/.test(path)) return 1_600;
  if (/(seed|data|mock|fixtures?|sample)/.test(path) || /\b(seed|sample|fictional|demo) data\b/.test(purpose)) return 4_500;
  if (/(store|context|hooks?|utils?|helpers?|format|storage|lib)\b/.test(path)) return 2_800;
  if (/\.tsx$/.test(path)) return /(app)\.tsx$/.test(path) ? 3_200 : 5_000;
  return 2_500;
}

/**
 * Splits planned files into ordered batches whose expected output stays well
 * inside the per-request limit. Order is preserved because later files import
 * earlier ones.
 */
export function planBatches(files: PlannedFile[], maxOutputTokens: number, maxFilesPerBatch = 4) {
  const budget = Math.max(2_000, Math.floor(maxOutputTokens * 0.6));
  const batches: PlannedFile[][] = [];
  let current: PlannedFile[] = [];
  let used = 0;
  for (const file of files) {
    const size = estimateOutputTokens(file);
    if (current.length && (used + size > budget || current.length >= maxFilesPerBatch)) { batches.push(current); current = []; used = 0; }
    current.push(file);
    used += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Splits a failed batch in two so each half asks for less output. */
export function splitBatch<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

/**
 * Recovers every complete {"path","content"} object from a JSON response that
 * was cut off at the output limit. Incomplete trailing objects are ignored, so
 * only files the model finished writing are kept.
 */
export function salvageFiles(raw: string): SourceFile[] {
  const start = raw.indexOf("[", Math.max(0, raw.indexOf('"files"')));
  if (start < 0) return [];
  const out: SourceFile[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;
  for (let i = start + 1; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { if (depth === 0) objectStart = i; depth += 1; continue; }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          const value = JSON.parse(raw.slice(objectStart, i + 1));
          if (value && typeof value.path === "string" && typeof value.content === "string") out.push({ path: value.path, content: value.content });
        } catch { /* not a complete object */ }
        objectStart = -1;
      }
      continue;
    }
    if (ch === "]" && depth === 0) break;
  }
  return out;
}

/** Screens and components: other steps need their imports and exports, not their markup. */
export function isScreenFile(path: string) {
  return /\.(tsx|jsx)$/.test(path) && !/(^|\/)(App|main)\.(tsx|jsx)$/.test(path) && !/(store|context|provider|hooks?)/i.test(path);
}

/**
 * Context of files already written, for the next step. Shared modules (types,
 * data, store, helpers, styles, App) are sent in full; screens are sent as
 * their import and export lines only. Keeps each request small without hiding
 * anything a new file needs to import.
 */
export function generatedContext(files: SourceFile[], maxChars = 90_000) {
  const shared = files.filter((file) => !isScreenFile(file.path)).map((file) => `--- ${file.path}\n${file.content}`);
  const screens = files.filter((file) => isScreenFile(file.path)).map((file) => `--- ${file.path} (imports and exports only)\n${file.content.split("\n").filter((line) => /^\s*(import|export)\b/.test(line)).join("\n")}`);
  return [...shared, ...screens].join("\n\n").slice(-maxChars);
}

/** Groups existing files for edits so each request carries a bounded amount of source. */
export function groupForEdit(paths: string[], sizes: Map<string, number>, maxChars = 24_000, maxFiles = 3) {
  const groups: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const path of paths) {
    const size = sizes.get(path) || 0;
    if (current.length && (used + size > maxChars || current.length >= maxFiles)) { groups.push(current); current = []; used = 0; }
    current.push(path);
    used += size;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Paths of project files named in a compiler or validation message. */
export function pathsInMessage(message: string, files: SourceFile[]) {
  const known = new Set(files.map((file) => file.path));
  const found = new Set<string>();
  for (const match of message.matchAll(/((?:src\/)?[A-Za-z0-9_@./-]+\.(?:tsx?|jsx?|css|json|html))/g)) {
    const candidate = match[1].replace(/^\.\//, "").replace(/^\/+/, "");
    for (const path of known) if (path === candidate || path.endsWith(`/${candidate}`) || candidate.endsWith(path)) found.add(path);
  }
  return [...found];
}

type Env = Record<string, string | undefined>;

function modelCostPaise(model: string, inputTokens: number, outputTokens: number, env: Env) {
  const price = priceFor(model, env);
  return usdToPaise(inputTokens * price.in + outputTokens * price.out, env);
}

/**
 * Credit estimate shown before approval. Expected cost follows the batches
 * the build will actually run; the range allows for repairs and the preview.
 * The amount held at approval is the expected cost (at least the configured
 * minimum, at most the top of the range); later steps extend the hold only if
 * the account has credits, and otherwise stop with the work saved.
 */
export function estimateBuildCredits(input: { files: PlannedFile[]; mode: "create" | "edit"; existing?: SourceFile[]; briefChars?: number; minimumHold?: number; env?: Env }) {
  const env = input.env || process.env;
  const model = env.OPENROUTER_CREATE_MODEL || "anthropic/claude-sonnet-5.5";
  const maxOutput = Number(env.OPENROUTER_BATCH_OUTPUT_TOKENS || 20_000);
  const existing = new Map((input.existing || []).map((file) => [file.path, file.content]));
  const briefTokens = Math.ceil((input.briefChars || 3_000) / 3.5);
  let paise = 0;
  if (input.mode === "create") {
    let written = 0;
    for (const batch of planBatches(input.files, maxOutput)) {
      const shared = batch.filter((file) => !isScreenFile(file.path)).reduce((sum, file) => sum + estimateOutputTokens(file) * 0.6, 0);
      // Batch sizing uses generous sizes; cost uses what production builds
      // actually produced (StudioMark, 2026-11-04: about 60% of those sizes).
      const output = batch.reduce((sum, file) => sum + estimateOutputTokens(file) * 0.6, 0);
      const inputTokens = 2_500 + briefTokens + Math.min(written, 26_000);
      paise += modelCostPaise(model, inputTokens, output, env);
      // Screens add only their import/export lines to later requests.
      written += shared + (output - shared) * 0.08;
    }
  } else {
    const contextTokens = Math.min(18_000, [...existing.values()].reduce((sum, content) => sum + content.length, 0) / 3.5);
    for (const file of input.files) {
      const current = existing.get(file.path);
      const output = current === undefined ? estimateOutputTokens(file) * 0.6 : Math.min(8_000, current.length / 3.5 * 0.5 + 600);
      paise += modelCostPaise(model, 2_500 + briefTokens + contextTokens + (current?.length || 0) / 3.5, output, env);
    }
  }
  const expected = Math.max(1, creditsForPaise(paise, env));
  const preview = 2;
  const low = Math.max(1, Math.round(expected * 0.75)) + preview;
  const high = Math.ceil(expected * 1.6) + preview + 2;
  const minimum = input.minimumHold ?? 0;
  const reserve = Math.min(high, Math.max(minimum, expected + preview));
  return { low, high, reserve };
}

export type ProjectBrief = {
  original?: string;
  plan?: { summary?: string; steps?: string[] };
  changes?: Array<{ build_id: string; request: string; summary?: string; status: "approved" | "applied" }>;
};

/**
 * Context sent with every follow-up so the model keeps the original
 * requirements and earlier changes, not only the latest message.
 */
export function briefContext(brief: ProjectBrief | null | undefined, currentBuildId?: string) {
  if (!brief?.original) return "";
  const parts = [`ORIGINAL PRODUCT BRIEF (every requirement here must stay satisfied unless the requested change replaces it):\n${brief.original.slice(0, 16_000)}`];
  if (brief.plan?.steps?.length) parts.push(`ORIGINALLY APPROVED PLAN:\n${brief.plan.summary || ""}\n${brief.plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`);
  const applied = (brief.changes || []).filter((change) => change.status === "applied" && change.build_id !== currentBuildId);
  if (applied.length) parts.push(`CHANGES ALREADY APPLIED (keep them):\n${applied.slice(-15).map((change) => `- ${(change.summary || change.request).slice(0, 400)}`).join("\n")}`);
  return parts.join("\n\n");
}

/** Deterministic part of the plan check: every planned file exists and nothing was dropped. */
export function deterministicCoverage(input: { planned: string[]; files: SourceFile[]; previous?: string[] }) {
  const present = new Set(input.files.filter((file) => file.content.trim().length > 0).map((file) => file.path));
  return {
    missingFiles: input.planned.filter((path) => !present.has(path)),
    removedFiles: (input.previous || []).filter((path) => !present.has(path)),
  };
}

/** Compact outline of the generated app for the coverage review (no full source). */
export function outlineForReview(files: SourceFile[], maxChars = 24_000) {
  const lines: string[] = [];
  for (const file of files.filter((item) => /\.(tsx?|jsx?)$/.test(item.path) && !item.path.endsWith(".d.ts"))) {
    const exports = [...file.content.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    const headings = [...file.content.matchAll(/<h[1-3][^>]*>([^<{]{2,80})</g)].map((match) => match[1].trim());
    const labels = [...file.content.matchAll(/(?:aria-label|title|placeholder)=["']([^"']{2,60})["']/g)].map((match) => match[1]);
    const buttons = [...file.content.matchAll(/<button[^>]*>([^<{]{2,40})</g)].map((match) => match[1].trim());
    lines.push(`${file.path}: exports ${exports.join(", ") || "none"}; headings ${headings.slice(0, 8).join(" | ") || "none"}; controls ${[...buttons, ...labels].slice(0, 12).join(" | ") || "none"}`);
  }
  return lines.join("\n").slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// Styling coverage. Screens are sent to later steps as imports/exports only,
// so a stylesheet written after them must be given the class names (and a
// compact outline of the markup) it has to style. After generation and after
// every edit, class names used in markup but defined nowhere are found and
// filled with a small, targeted styles step.

const CLASS_TOKEN = /^-?[_a-zA-Z][\w-]*$/;

/** Class names a JSX/TSX file uses: className strings, template literals and string literals inside className expressions (cn, clsx, conditionals). */
export function classNamesIn(content: string): string[] {
  const found = new Set<string>();
  const add = (text: string) => { for (const token of text.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (CLASS_TOKEN.test(token)) found.add(token); };
  for (const match of content.matchAll(/className\s*=\s*"([^"]*)"|className\s*=\s*'([^']*)'/g)) add(match[1] ?? match[2] ?? "");
  let index = 0;
  while ((index = content.indexOf("className={", index)) >= 0) {
    let depth = 0;
    let end = index + "className=".length;
    for (; end < content.length; end += 1) {
      if (content[end] === "{") depth += 1;
      else if (content[end] === "}" && --depth === 0) break;
    }
    const expression = content.slice(index + "className={".length, end);
    // Template literals contribute their static text and any strings inside ${…}.
    const withoutTemplates = expression.replace(/`([^`]*)`/g, (_whole, body: string) => {
      add(body);
      for (const inner of body.matchAll(/\$\{([^}]*)\}/g)) for (const literal of inner[1].matchAll(/"([^"]*)"|'([^']*)'/g)) add(literal[1] ?? literal[2] ?? "");
      return " ";
    });
    for (const literal of withoutTemplates.matchAll(/"([^"]*)"|'([^']*)'/g)) add(literal[1] ?? literal[2] ?? "");
    index = end;
  }
  return [...found];
}

/** Class selectors a stylesheet defines (comments and url() contents ignored). */
export function cssSelectorsIn(css: string): Set<string> {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/url\([^)]*\)/g, " ");
  return new Set([...cleaned.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]));
}

const markupFile = (path: string) => /\.(tsx|jsx)$/.test(path);

/**
 * Class names used in markup that no stylesheet defines. Skipped for apps
 * that use Tailwind, where class names are utilities rather than selectors.
 */
export function styleGaps(files: SourceFile[], scope?: string[]) {
  const pkg = files.find((file) => file.path === "package.json")?.content || "";
  const css = files.filter((file) => file.path.endsWith(".css"));
  if (/"tailwindcss"/.test(pkg) || /@tailwind\b|@import\s+["']tailwindcss/.test(css.map((file) => file.content).join("\n"))) return { missing: [] as string[], used: 0, byFile: {} as Record<string, string[]>, skipped: "tailwind" as const };
  const defined = cssSelectorsIn(css.map((file) => file.content).join("\n"));
  const byFile: Record<string, string[]> = {};
  const used = new Set<string>();
  for (const file of files.filter((item) => markupFile(item.path) && (!scope || scope.includes(item.path)))) {
    const names = classNamesIn(file.content);
    names.forEach((name) => used.add(name));
    const missing = names.filter((name) => !defined.has(name));
    if (missing.length) byFile[file.path] = missing;
  }
  const missing = [...new Set(Object.values(byFile).flat())];
  return { missing, used: used.size, byFile, skipped: null };
}

/** Whether the gaps are big enough to need a styles step (a few unstyled hooks are normal). */
export function needsStyles(gaps: ReturnType<typeof styleGaps>, scoped = false) {
  // For an edit, any new unstyled markup in the changed files needs styles.
  if (scoped) return gaps.missing.length >= 2;
  return gaps.missing.length >= 3 && gaps.missing.length >= Math.ceil(gaps.used * 0.1);
}

/** Compact outline of the markup: one line per element that carries a className. */
export function markupOutline(files: SourceFile[], options: { only?: Set<string>; maxPerFile?: number; maxChars?: number } = {}) {
  const lines: string[] = [];
  for (const file of files.filter((item) => markupFile(item.path))) {
    const rows: string[] = [];
    for (const match of file.content.matchAll(/<([A-Za-z][\w.]*)\b[^<>]*?className\s*=\s*("[^"]*"|'[^']*'|\{[^<>]*?\})/g)) {
      const names = classNamesIn(`className=${match[2]}`);
      if (!names.length || (options.only && !names.some((name) => options.only!.has(name)))) continue;
      rows.push(`<${match[1]} class="${names.join(" ")}">`);
      if (rows.length >= (options.maxPerFile ?? 70)) break;
    }
    if (rows.length) lines.push(`--- ${file.path}\n${rows.join("\n")}`);
  }
  return lines.join("\n").slice(0, options.maxChars ?? 22_000);
}

/** Context for a step that writes a stylesheet after screens exist. */
export function styleContext(files: SourceFile[], maxChars = 26_000) {
  const screens = files.filter((file) => markupFile(file.path));
  if (!screens.length) return "";
  const inventory = screens.map((file) => { const names = classNamesIn(file.content); return names.length ? `${file.path}: ${names.join(" ")}` : ""; }).filter(Boolean).join("\n");
  return `CLASS NAMES THE SCREENS USE (the stylesheet must style every one of these; do not invent different names):\n${inventory}\n\nMARKUP OUTLINE (element and classes, in order):\n${markupOutline(screens, { maxChars: Math.max(4_000, maxChars - inventory.length) })}`.slice(0, maxChars);
}

/** Keeps only complete CSS rules from a response that may have been cut off. */
export function completeCss(css: string) {
  let depth = 0;
  let lastComplete = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") { depth -= 1; if (depth === 0) lastComplete = i + 1; }
  }
  return css.slice(0, lastComplete).trim();
}

// ---------------------------------------------------------------------------
// Plan coverage evidence: for each approved step, the files most likely to
// implement it (changed files first, then files sharing its words), sent as
// source excerpts rather than an outline, so features built from data (for
// example labels in arrays or options) are visible to the checker.

const STOP = new Set(["with", "that", "this", "from", "have", "each", "their", "they", "them", "when", "also", "into", "every", "only", "both", "plus", "about", "which", "while", "after", "before", "stays", "shows", "show", "page", "user", "users", "can", "and", "the", "for", "are", "all"]);
function words(text: string) { return [...new Set(text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])].filter((word) => !STOP.has(word)); }

/**
 * Focused excerpt of a long file: its opening (imports, types, constants) and
 * every line that matches a plan word or carries visible text (JSX text,
 * labels, placeholders, option and string arrays), in source order.
 */
function excerpt(content: string, terms: string[], max: number) {
  const lines = content.split("\n");
  // Rank lines: controls and visible labels first, then visible text, then plan words, then the file's opening.
  const score = (line: string, i: number) => {
    const lower = line.toLowerCase();
    let value = 0;
    if (/<(button|option|select|label|h[1-4]|th|input|textarea)\b|aria-label=|placeholder=/.test(line)) value += 4;
    if (/["'`][A-Z][^"'`]{5,}["'`]/.test(line) || />[^<>{}]{3,}</.test(line) || /\[\s*["'][^"']{3,}["']\s*,/.test(line)) value += 2;
    value += Math.min(3, terms.filter((term) => lower.includes(term)).length);
    if (i < 20) value += 1;
    return value;
  };
  const ranked = lines.map((line, i) => ({ i, line: line.trimEnd(), value: score(line, i) })).filter((item) => item.value > 0 && item.line.trim()).sort((a, b) => b.value - a.value || a.i - b.i);
  const keep: typeof ranked = [];
  let used = 0;
  for (const item of ranked) { if (used + item.line.length + 1 > max) continue; keep.push(item); used += item.line.length + 1; }
  keep.sort((a, b) => a.i - b.i);
  const out: string[] = [];
  let previous = -1;
  for (const item of keep) { if (item.i !== previous + 1) out.push("…"); out.push(item.line); previous = item.i; }
  return out.join("\n");
}

export function coverageEvidence(input: { steps: string[]; files: SourceFile[]; changed?: string[]; maxChars?: number }) {
  const max = input.maxChars ?? 48_000;
  const source = input.files.filter((file) => /\.(tsx?|jsx?)$/.test(file.path) && !file.path.endsWith(".d.ts") && !/(^|\/)(main|vite-env)\./.test(file.path));
  const changed = new Set(input.changed || []);
  const chosen = new Map<string, number>();
  for (const step of input.steps) {
    const terms = words(step);
    const ranked = source.map((file) => {
      const text = `${file.path} ${file.content}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + Math.min(5, text.split(term).length - 1), 0) + (changed.has(file.path) ? 6 : 0);
      return { path: file.path, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    for (const item of ranked) chosen.set(item.path, Math.max(chosen.get(item.path) || 0, item.score));
  }
  const ordered = [...chosen].sort((a, b) => b[1] - a[1]).map(([path]) => source.find((file) => file.path === path)!);
  const perFile = Math.max(3_000, Math.floor(max / Math.max(1, ordered.length)));
  const allTerms = words(input.steps.join(" "));
  const parts = ordered.map((file) => `--- ${file.path}${changed.has(file.path) ? " (changed in this build)" : ""}\n${file.content.length > perFile ? excerpt(file.content, allTerms, perFile) : file.content}`);
  const others = source.filter((file) => !chosen.has(file.path)).map((file) => file.path);
  return `${parts.join("\n\n")}${others.length ? `\n\nOTHER FILES (not shown): ${others.join(", ")}` : ""}`.slice(0, max);
}

/** The app's own name, from the generated index.html title. */
export function appNameFrom(files: SourceFile[]) {
  const html = files.find((file) => file.path === "index.html")?.content || "";
  const title = html.match(/<title>([^<]{1,120})<\/title>/i)?.[1]?.trim() || "";
  return title.split(/\s[|—–-]\s/)[0].trim() || null;
}

function coverageNotes(coverage: { missing?: string[]; unconfirmed?: string[] }) {
  const parts: string[] = [];
  if (coverage.missing?.length) parts.push(`Not built yet (from the approved plan):\n${coverage.missing.map((item) => `- ${item}`).join("\n")}\n\nAsk NYNZ to add these and it will build them on top of this version.`);
  if (coverage.unconfirmed?.length) parts.push(`Couldn't confirm automatically (please check these in the preview):\n${coverage.unconfirmed.map((item) => `- ${item}`).join("\n")}`);
  return parts;
}

/**
 * The assistant message posted when a build or edit has been validated and
 * published. Written from the completed result (app name, approved steps,
 * files changed), never from the plan's proposal text, which is posted
 * separately when the plan is ready. "Not built yet" is used only for
 * features known to be missing; anything the check could not verify is
 * listed as "Couldn't confirm".
 */
export function completionMessage(input: { mode: "create" | "edit"; appName?: string | null; plan?: { summary?: string; steps?: string[] } | null; changed?: string[]; coverage?: { missing?: string[]; unconfirmed?: string[] } }) {
  const short = (text: string) => { const head = text.split(/:\s/)[0].trim(); return (head.length >= 6 && head.length <= 70 ? head : text.length > 90 ? `${text.slice(0, 87).trimEnd()}…` : text).replace(/\.$/, ""); };
  const parts: string[] = [];
  if (input.mode === "create") {
    parts.push(`${input.appName || "Your app"} is built and running in the preview.`);
    const steps = (input.plan?.steps || []).slice(0, 6).map(short).filter(Boolean);
    if (steps.length) parts.push(`What's included:\n${steps.map((step) => `- ${step}`).join("\n")}`);
  } else {
    const summary = (input.plan?.summary || "").trim().replace(/\.$/, "");
    parts.push(summary ? `Your change is live in the preview: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}.` : "Your change is live in the preview.");
    const files = (input.changed || []).map((path) => path.split("/").pop()!);
    if (files.length) parts.push(`Updated: ${files.slice(0, 6).join(", ")}${files.length > 6 ? ` and ${files.length - 6} more` : ""}.`);
  }
  parts.push(...coverageNotes(input.coverage || {}));
  parts.push("Open the Preview tab to try it, and tell me what to change next.");
  return parts.join("\n\n");
}
