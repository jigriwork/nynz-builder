import { generateWithOpenRouter, type ApplicationManifest, type BeforeRequest, type OnStep } from "./openrouter";

type SourceFile = { path: string; content: string };
type Input = {
  prompt: string; files: SourceFile[]; references?: string; mode?: "create" | "edit"; approvedManifest?: ApplicationManifest;
  /** Files finished by an earlier run of this build (create) and paths already handled (edit). */
  completed?: SourceFile[]; completedPaths?: string[]; targets?: string[];
  onStep?: OnStep;
  onAttempt?: (attempt: number) => Promise<void>;
  onFiles?: (files: SourceFile[]) => Promise<void>;
  onUsage?: (event: { prompt_tokens: number; completion_tokens: number; costUsd: number; model: string; requestId: string | null }) => Promise<void>;
  onProgress?: (event: { current: number; total: number; percent: number; message?: string }) => Promise<void>;
  beforeRequest?: BeforeRequest;
  signal?: AbortSignal;
};

/**
 * OpenRouter is the only supported provider for the customer flow: planning
 * (which every create/edit requires) and generation both use it. The former
 * Sarvam fallback could never complete a build because planning had no
 * fallback, so it is no longer offered. Readiness is checked by the worker at
 * start-up, advertised through its heartbeat, and checked by the build API
 * before any request (and any credit reservation) is accepted.
 */
export function generationReadiness(env: Record<string, string | undefined> = process.env) {
  if (!env.OPENROUTER_API_KEY) return { ready: false as const, provider: null, reason: "OPENROUTER_API_KEY is not configured" };
  return { ready: true as const, provider: "openrouter" as const, reason: null };
}

export async function generateApplication(input: Input) {
  const readiness = generationReadiness();
  if (!readiness.ready) throw new Error(`GENERATOR_NOT_CONFIGURED: ${readiness.reason}`);
  return generateWithOpenRouter(input);
}
