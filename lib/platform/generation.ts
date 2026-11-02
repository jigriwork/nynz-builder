import { generateWithOpenRouter } from "./openrouter";
import { generateWithSarvam } from "./sarvam";

type Input = Parameters<typeof generateWithSarvam>[0];

export async function generateApplication(input: Input) {
  if (process.env.OPENROUTER_API_KEY) return generateWithOpenRouter(input);
  return generateWithSarvam(input);
}
