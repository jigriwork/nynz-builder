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
