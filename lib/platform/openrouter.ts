import { z } from "zod";
import { filesAreSafe, safeProjectPath } from "./security";
import {
  EDIT_SYSTEM,
  applyGeneratedEdits,
  editGeneratedSchema,
  generatedSchema,
  normalizeGeneratedFile,
  validateCreateDependencies,
  validateSourceSyntax,
  type GeneratedApp,
} from "./sarvam";

type SourceFile = { path: string; content: string };
type Usage = { prompt_tokens: number; completion_tokens: number; costUsd: number };
type OnUsage = (event: Usage & { model: string; requestId: string | null }) => Promise<void>;
type OnProgress = (event: { current: number; total: number; percent: number }) => Promise<void>;

const manifestSchema = z.object({
  plan: z.object({ summary: z.string(), steps: z.array(z.string()).min(1).max(12) }),
  message: z.string(),
  files: z.array(z.object({ path: z.string(), purpose: z.string() })).min(5).max(40),
});

const batchSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(5),
});

const MANIFEST_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["plan", "message", "files"],
  properties: {
    plan: { type: "object", additionalProperties: false, required: ["summary", "steps"], properties: { summary: { type: "string" }, steps: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } } } },
    message: { type: "string" },
    files: { type: "array", minItems: 5, maxItems: 40, items: { type: "object", additionalProperties: false, required: ["path", "purpose"], properties: { path: { type: "string" }, purpose: { type: "string" } } } },
  },
} as const;

const BATCH_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["files"],
  properties: { files: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } } },
} as const;

const EDIT_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["plan", "message", "edits"],
  properties: {
    plan: { type: "object", additionalProperties: false, required: ["summary", "steps"], properties: { summary: { type: "string" }, steps: { type: "array", maxItems: 12, items: { type: "string" } } } },
    message: { type: "string" },
    edits: { type: "array", minItems: 1, maxItems: 60, items: { type: "object", additionalProperties: false, required: ["path", "search", "replace"], properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } } } },
  },
} as const;

const QUALITY = `You are NYNZ, a world-class product design and software engineering team.
Build a complete React, TypeScript and Vite product, not a toy, wireframe, generic dashboard or static mockup.
Infer the real domain workflow, screens, navigation, data states and interactions from the brief.
Use polished human copy, responsive layouts, accessible controls, purposeful motion and professional visual art direction.
Every visible control must work. Use local demonstration data when a real backend was not requested.
Use supplied assets at their exact /uploads paths. Use graceful image fallbacks.
Prefer focused components and data modules. Keep every file below 16,000 characters.
Match architecture to the actual brief. A calculator or other single-purpose utility should normally use 7–10 files; do not split trivial UI into many tiny files. Reserve larger manifests for genuinely multi-screen products.
Never use semantic Tailwind utilities such as bg-background, text-foreground or border-border inside @apply unless the Tailwind theme defines them. Prefer ordinary CSS for global defaults.
Use no secrets. Include every imported package in package.json. The result must pass npm run build.`;

function models(role: "plan" | "create" | "edit") {
  const primary = role === "plan"
    ? process.env.OPENROUTER_PLANNER_MODEL || "openai/gpt-5.6-luna"
    : role === "edit"
      ? process.env.OPENROUTER_EDIT_MODEL || "openai/gpt-5.6-luna"
      : process.env.OPENROUTER_CREATE_MODEL || "openai/gpt-5";
  const fallbacks = (process.env.OPENROUTER_FALLBACK_MODELS || "z-ai/glm-4.6,anthropic/claude-sonnet-4.5").split(",").map((item) => item.trim()).filter(Boolean);
  return [primary, ...fallbacks.filter((item) => item !== primary)];
}

async function completion(input: { role: "plan" | "create" | "edit"; system: string; user: string; schema: object; schemaName: string; maxTokens: number; onUsage?: OnUsage }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPENROUTER_REQUEST_TIMEOUT_MS || 240_000));
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "HTTP-Referer": "https://www.nynz.in", "X-Title": "NYNZ" },
      body: JSON.stringify({
        models: models(input.role), temperature: input.role === "plan" ? 0.25 : 0.15,
        max_tokens: input.maxTokens, usage: { include: true },
        // Source generation is a long-output workload. Prioritise sustained
        // tokens/second instead of the cheapest endpoint so users spend less
        // time waiting on multi-thousand-token application files.
        provider: { allow_fallbacks: true, require_parameters: true, data_collection: "deny", sort: "throughput" },
        response_format: { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.schema } },
        messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter request rejected (${response.status}): ${(await response.text()).replace(/\s+/g, " ").slice(0, 400)}`);
    const raw = await response.json();
    const choice = raw.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("OpenRouter response reached its output limit");
    if (!choice?.message?.content) throw new Error("OpenRouter returned an empty response");
    const usage: Usage = { prompt_tokens: Number(raw.usage?.prompt_tokens || 0), completion_tokens: Number(raw.usage?.completion_tokens || 0), costUsd: Number(raw.usage?.cost || 0) };
    const model = String(raw.model || models(input.role)[0]);
    const requestId = response.headers.get("x-request-id");
    await input.onUsage?.({ ...usage, model, requestId });
    return { value: JSON.parse(choice.message.content), usage, model, requestId };
  } finally { clearTimeout(timeout); }
}

function addUsage(total: Usage, next: Usage) {
  total.prompt_tokens += next.prompt_tokens; total.completion_tokens += next.completion_tokens; total.costUsd += next.costUsd;
}

function assertBudget(usage: Usage) {
  const limitInr = Number(process.env.OPENROUTER_MAX_COST_INR_PER_BUILD || 75);
  const spentInr = usage.costUsd * Number(process.env.USD_TO_INR_RATE || 95);
  if (spentInr > limitInr) throw new Error(`Build stopped at its ₹${limitInr.toFixed(0)} model spending limit`);
}

function validateProduct(files: SourceFile[], prompt: string) {
  validateSourceSyntax(files);
  validateCreateDependencies(files);
  const source = files.filter((file) => /\.[jt]sx?$/.test(file.path)).map((file) => file.content).join("\n");
  const styles = files.filter((file) => file.path.endsWith(".css")).map((file) => file.content).join("\n");
  const compactBrief = /\b(?:minimal|simple|single[- ]page|one[- ]page)\b/i.test(prompt);
  const minimumSource = compactBrief ? 700 : 3_500;
  const minimumClassNames = compactBrief ? 12 : 16;
  const minimumStyles = compactBrief ? 500 : 900;
  const tooSmall = source.length < minimumSource || (compactBrief ? source.length + styles.length < 2_000 : false);
  const toyCounter = /Count:\s*\{count\}|Increment<\/button>/i.test(source);
  const classNameCount = (source.match(/className\s*=/g) || []).length;
  const tooLightlyStyled = compactBrief ? classNameCount < 8 && styles.length < 350 : classNameCount < minimumClassNames && styles.length < minimumStyles;
  if (tooSmall || toyCounter || tooLightlyStyled) {
    throw new Error(`Generated application is not complete enough to publish (source ${source.length}, styles ${styles.length})`);
  }
}

async function createApplication(input: { prompt: string; references?: string; onAttempt?: (attempt: number) => Promise<void>; onUsage?: OnUsage; onProgress?: OnProgress }) {
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, costUsd: 0 };
  await input.onAttempt?.(1);
  const planned = await completion({
    role: "plan", schema: MANIFEST_JSON_SCHEMA, schemaName: "nynz_manifest", maxTokens: 4_000,
    system: `${QUALITY}\nReturn only a JSON implementation plan and ordered file manifest. Include package.json, index.html, TypeScript configuration, Vite configuration, src/main.tsx, responsive styles, data and focused components.`,
    user: `PRODUCT BRIEF:\n${input.prompt}\n\nREFERENCES AND ASSETS:\n${input.references?.slice(0, 40_000) || "None"}`, onUsage: input.onUsage,
  });
  addUsage(usage, planned.usage);
  assertBudget(usage);
  const manifest = manifestSchema.parse(planned.value);
  const safeManifest = manifest.files.map((file) => ({ ...file, path: safeProjectPath(file.path) }));
  const manifestPaths = new Set(safeManifest.map((file) => file.path));
  if (manifestPaths.size !== safeManifest.length) throw new Error("Application plan contains duplicate file paths");
  for (const required of ["package.json", "index.html", "src/main.tsx", "src/App.tsx"]) {
    if (!manifestPaths.has(required)) throw new Error(`Application plan is missing ${required}`);
  }
  if (![...manifestPaths].some((path) => path.endsWith(".css"))) throw new Error("Application plan is missing responsive styles");
  const generated: SourceFile[] = [];
  const batches = Array.from({ length: Math.ceil(safeManifest.length / 4) }, (_, index) => safeManifest.slice(index * 4, index * 4 + 4));
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const existing = generated.map((file) => `--- ${file.path}\n${file.content}`).join("\n\n").slice(-120_000);
    let batchError: unknown;
    let completed = false;
    for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
      await input.onAttempt?.(index + 2);
      await input.onProgress?.({ current: index + 1, total: batches.length, percent: Math.round(22 + (index / batches.length) * 42) });
      try {
        const result = await completion({
          role: "create", schema: BATCH_JSON_SCHEMA, schemaName: "nynz_files", maxTokens: Number(process.env.OPENROUTER_BATCH_OUTPUT_TOKENS || 12_000),
          system: `${QUALITY}\nReturn only the requested files as JSON. Produce every requested path exactly once. Keep imports consistent with the manifest and files already generated.`,
          user: `PRODUCT BRIEF:\n${input.prompt}\n\nCOMPLETE MANIFEST:\n${safeManifest.map((file) => `${file.path}: ${file.purpose}`).join("\n")}\n\nGENERATE THIS BATCH (${index + 1}/${batches.length}), ATTEMPT ${attempt}:\n${batch.map((file) => `${file.path}: ${file.purpose}`).join("\n")}\n\nFILES ALREADY GENERATED:\n${existing || "None"}\n\nREFERENCES:\n${input.references?.slice(0, 20_000) || "None"}${attempt > 1 ? "\n\nThe previous batch was invalid or incomplete. Return all requested paths with complete syntax and no extra files." : ""}`,
          onUsage: input.onUsage,
        });
        addUsage(usage, result.usage);
        assertBudget(usage);
        const parsed = batchSchema.parse(result.value);
        const expected = new Set(batch.map((file) => file.path));
        const files = filesAreSafe(parsed.files).map(normalizeGeneratedFile);
        const returned = new Set(files.map((file) => file.path));
        if (files.some((file) => !expected.has(file.path)) || returned.size !== files.length || [...expected].some((path) => !returned.has(path))) throw new Error(`OpenRouter returned the wrong files for batch ${index + 1}`);
        validateSourceSyntax(files);
        generated.push(...files);
        completed = true;
        await input.onProgress?.({ current: index + 1, total: batches.length, percent: Math.round(22 + ((index + 1) / batches.length) * 42) });
      } catch (error) { batchError = error; }
    }
    if (!completed) throw batchError instanceof Error ? batchError : new Error(`Could not generate batch ${index + 1}`);
  }
  const files = filesAreSafe(generated).map(normalizeGeneratedFile);
  validateProduct(files, input.prompt);
  const result: GeneratedApp = generatedSchema.parse({ plan: manifest.plan, message: manifest.message, files });
  return { result, usage, requestId: planned.requestId, model: `openrouter:${planned.model}` };
}

async function editApplication(input: { prompt: string; files: SourceFile[]; references?: string; onAttempt?: (attempt: number) => Promise<void>; onUsage?: OnUsage }) {
  let lastError: unknown;
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, costUsd: 0 };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await input.onAttempt?.(attempt);
    try {
      const response = await completion({
        role: "edit", schema: EDIT_JSON_SCHEMA, schemaName: "nynz_edit", maxTokens: 12_000,
        system: EDIT_SYSTEM,
        user: `REQUEST:\n${input.prompt}\n\nCURRENT FILES:\n${input.files.map((file) => `--- ${file.path}\n${file.content}`).join("\n").slice(0, 180_000)}\n\nREFERENCES:\n${input.references?.slice(0, 30_000) || "None"}${attempt > 1 ? "\n\nThe previous edit was invalid. Use smaller exact search and replace operations." : ""}`,
        onUsage: input.onUsage,
      });
      addUsage(usage, response.usage);
      assertBudget(usage);
      const edit = editGeneratedSchema.parse(response.value);
      const files = applyGeneratedEdits(input.files, edit.edits);
      validateSourceSyntax(files);
      return { result: generatedSchema.parse({ plan: edit.plan, message: edit.message, files }), usage, requestId: response.requestId, model: `openrouter:${response.model}` };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter edit failed");
}

export async function generateWithOpenRouter(input: { prompt: string; files: SourceFile[]; references?: string; mode?: "create" | "edit"; onAttempt?: (attempt: number) => Promise<void>; onUsage?: OnUsage; onProgress?: OnProgress }) {
  return input.mode === "create" ? createApplication(input) : editApplication(input);
}
