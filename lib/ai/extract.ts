// 05 section 3.6: the extraction call (two 7 s attempts under one 15 s signal, D4) and finalizeTerms().
import { DealError } from "@/lib/deal/errors";
import { AiError, callJson, type CallParams, type MessagesClient } from "./call-json";
import { claude, model } from "./client";
import { EXTRACT_SYSTEM, buildExtractMessages } from "./prompts";
import { EXTRACT_SCHEMA, ExtractZ, type ExtractRaw } from "./schemas";
import { EXTRACT_PROMPT_VERSION, type ExtractInput, type ExtractOutput, type RawResponse } from "./types";

export async function extract(input: ExtractInput, client: MessagesClient = claude()): Promise<ExtractOutput> {
  const signal = AbortSignal.timeout(15_000);
  const params: CallParams = {
    model: model(), max_tokens: 2_000, effort: "low",
    system: EXTRACT_SYSTEM,
    messages: buildExtractMessages(input.sentence, input.today),
  };
  let last: AiError | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, raw } = await callJson(client, params, EXTRACT_SCHEMA, ExtractZ, { timeout: 7_000, maxRetries: 0, signal });
      return finalizeTerms(data, raw);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      last = err;
      if (signal.aborted) break; // overall budget spent: no second attempt
    }
  }
  // H2: the failure kind goes to the server log, the client gets the fixed message.
  console.warn(`extract failed after retry: ${last?.failure.kind}`);
  throw new DealError("ai_unavailable", "the model did not answer; try again");
}

/** Fixed post-processing rules, in order. The deal-code condition is NOT added here: lib/deal/terms.ts appends it (D6). */
export function finalizeTerms(data: ExtractRaw, raw: RawResponse): ExtractOutput {
  // 1. Currency: USD only (A6). A price with no currency is USD.
  if (data.currency !== null && data.currency !== "USD") {
    throw new DealError("unsupported_currency", `Only USD deals are supported; the sentence states a price in ${data.currency}.`);
  }
  const currency = data.amount_minor === null ? null : "USD";

  // 2. Keep the first 4 model conditions, one tracking condition at most, no duplicates (D6).
  const seen = new Set<string>();
  const conditions = data.conditions
    .filter((c) => {
      const key = c.evidence_type === "tracking" ? "tracking" : c.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => (c.evidence_type === "tracking" ? { ...c, text: "Tracking shows delivered" } : c))
    .slice(0, 4);

  // 3. Nothing checkable: reject (D6, H2 condition_not_checkable).
  if (conditions.length === 0) {
    const hint = data.rejected[0]?.suggestion ? ` Try: "${data.rejected[0].suggestion}".` : "";
    throw new DealError("condition_not_checkable", `No part of the sentence can be checked from a photo or a tracking status.${hint}`);
  }

  return {
    item_title: data.item_title,
    amount_minor: data.amount_minor, // null -> the UI asks (D6)
    currency,
    deadline_days: data.deadline_days, // null -> the UI asks (D6)
    conditions,
    rejected: data.rejected,
    model: model(),
    prompt_version: EXTRACT_PROMPT_VERSION,
    raw_response: raw,
  };
}
