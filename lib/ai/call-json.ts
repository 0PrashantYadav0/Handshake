// 05 section 2.2: the one function that makes every model call. Branches on stop_reason before parsing,
// finds the text block by type, JSON.parse, Zod, and maps every failure to AiError with the RawResponse.
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AiFailure, RawResponse } from "./types";

export type { AiFailure, RawResponse } from "./types";

/** The slice of the SDK client we use; tests pass a fake. */
export interface MessagesClient {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      opts?: Anthropic.RequestOptions,
    ): Promise<Anthropic.Message & { _request_id?: string | null }>;
  };
}

export class AiError extends Error {
  constructor(public readonly failure: AiFailure, public readonly raw: RawResponse) {
    super(failure.kind);
    this.name = "AiError";
  }
}

export interface CallParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  effort: "low" | "medium" | "high";
}

export async function callJson<T>(
  client: MessagesClient,
  params: CallParams,
  schema: Record<string, unknown>,
  validator: z.ZodType<T>,
  opts: Anthropic.RequestOptions, // { timeout, maxRetries: 0, signal }
): Promise<{ data: T; raw: RawResponse }> {
  const started = Date.now();
  const raw: RawResponse = {
    request_id: null, model: params.model, stop_reason: null, stop_category: null,
    usage: null, latency_ms: 0, text: null, output: null, error: null,
  };
  const fail = (failure: AiFailure): never => {
    raw.latency_ms = Date.now() - started;
    raw.error = failure;
    throw new AiError(failure, raw);
  };

  let msg: Anthropic.Message & { _request_id?: string | null };
  try {
    const { effort, ...rest } = params;
    // No tools, no temperature, no thinking: see 05 section 2 table.
    msg = await client.messages.create({ ...rest, output_config: { effort, format: { type: "json_schema", schema } } }, opts);
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIUserAbortError) return fail({ kind: "timeout" });
    if (err instanceof Anthropic.APIError) {
      // 429 RateLimitError, 5xx/529 InternalServerError, 400 BadRequestError (bad schema) all land here.
      return fail({ kind: "api_error", status: err.status ?? null, type: err.type ?? null, message: err.message });
    }
    return fail({ kind: "api_error", status: null, type: null, message: String(err) });
  }

  raw.latency_ms = Date.now() - started;
  raw.request_id = msg._request_id ?? null;
  raw.stop_reason = msg.stop_reason;
  raw.usage = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };

  if (msg.stop_reason === "refusal") {
    raw.stop_category = msg.stop_details?.category ?? null;
    return fail({ kind: "refusal", category: raw.stop_category });
  }
  if (msg.stop_reason !== "end_turn") return fail({ kind: "stop", stop_reason: String(msg.stop_reason) });

  const block = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block) return fail({ kind: "no_text" });
  raw.text = block.text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return fail({ kind: "bad_json" });
  }
  raw.output = parsed;

  const result = validator.safeParse(parsed);
  if (!result.success) return fail({ kind: "schema_mismatch", issues: JSON.stringify(result.error.issues) });
  return { data: result.data, raw };
}
