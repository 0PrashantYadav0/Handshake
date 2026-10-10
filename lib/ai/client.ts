// 05 section 2.1. Constructed lazily so `next build` never needs ANTHROPIC_API_KEY (D1).
import Anthropic from "@anthropic-ai/sdk";

export const model = (): string => process.env.AI_MODEL ?? "claude-sonnet-5-5";

let client: Anthropic | undefined;
export function claude(): Anthropic {
  // apiKey defaults to process.env.ANTHROPIC_API_KEY. maxRetries 0: we own the retry (05 section 2).
  return (client ??= new Anthropic({ timeout: 17_000, maxRetries: 0 }));
}
