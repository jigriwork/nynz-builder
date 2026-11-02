import { generateWithOpenRouter } from "./openrouter";
import { generateWithSarvam } from "./sarvam";

type Input = Parameters<typeof generateWithSarvam>[0] & { onUsage?: (event: { prompt_tokens: number; completion_tokens: number; costUsd: number; model: string; requestId: string | null }) => Promise<void>; onProgress?: (event: { current: number; total: number; percent: number }) => Promise<void> };

export async function generateApplication(input: Input) {
  if (process.env.OPENROUTER_API_KEY) return generateWithOpenRouter(input);
  return generateWithSarvam(input);
}
