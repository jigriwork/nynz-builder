import { randomUUID } from "node:crypto";
import { validateCreateDependencies, validateLocalImports, validateSourceSyntax } from "./sarvam";

type SourceFile = { path: string; content: string };
type Options = {
  signal?: AbortSignal;
  beforeCreate?: (seconds: number) => Promise<void>;
  onBuildFailure?: (error: string, files: SourceFile[], attempt: number) => Promise<SourceFile[]>;
  onStage?: (message: string, percent: number) => Promise<void>;
  onCreated?: (sandboxId: string) => Promise<void>;
};

/**
 * Local stand-in for the E2B preview, used only by the local StudioMark
 * fixture. It is enabled only outside production, with an explicit flag, and
 * only against a database on this machine, so it can never replace the real
 * isolated sandbox for customers. It runs the same syntax, import and
 * dependency checks as the generator, and a file containing the marker
 * NYNZ_FIXTURE_COMPILE_ERROR fails "compilation" so the repair path runs.
 */
export function localFixtureSandboxEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NYNZ_LOCAL_FIXTURE_SANDBOX === "1" && env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL || "");
}

function compile(files: SourceFile[]) {
  validateSourceSyntax(files);
  validateLocalImports(files);
  validateCreateDependencies(files);
  const broken = files.find((file) => file.content.includes("NYNZ_FIXTURE_COMPILE_ERROR"));
  if (broken) throw new Error(`Production build failed: ${broken.path}(1,1): error TS2304: Cannot find name 'NYNZ_FIXTURE_COMPILE_ERROR'.`);
}

export async function runLocalFixtureSandbox(input: SourceFile[], _backend?: unknown, _assets: unknown[] = [], options: Options = {}) {
  if (!localFixtureSandboxEnabled()) throw new Error("Local fixture sandbox is disabled");
  options.signal?.throwIfAborted();
  // Same allocation as a real E2B sandbox, so billing behaves as in production.
  await options.beforeCreate?.(Math.ceil(Number(process.env.E2B_SANDBOX_TIMEOUT_MS || 600_000) / 1000));
  const sandboxId = `local-fixture-${randomUUID().slice(0, 8)}`;
  await options.onCreated?.(sandboxId);
  const merged = new Map(input.map((file) => [file.path, file.content]));
  await options.onStage?.("Installing application dependencies", 70);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    options.signal?.throwIfAborted();
    await options.onStage?.(attempt === 1 ? "Compiling and typechecking the application" : "Rechecking the repaired application", 80);
    try {
      compile([...merged].map(([path, content]) => ({ path, content })));
      await options.onStage?.("Starting the secure application preview", 90);
      return { sandboxId, expiresAt: null, logs: "local fixture build passed" };
    } catch (error) {
      if (!options.onBuildFailure || attempt === 3 || !(error instanceof Error) || !error.message.startsWith("Production build failed")) throw error;
      const repaired = await options.onBuildFailure(error.message, [...merged].map(([path, content]) => ({ path, content })), attempt);
      for (const file of repaired) merged.set(file.path, file.content);
    }
  }
  throw new Error("Production build did not complete");
}
