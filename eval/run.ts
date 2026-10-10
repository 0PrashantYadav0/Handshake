// The eval runner (05 section 9.3; T-29). `npm run eval -- [flags]`. Never imported by app code; tests import the pure parts
// and run runCases() against a fake client. Live calls need ANTHROPIC_API_KEY; --dry assembles inputs and makes no call.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { MessagesClient } from "@/lib/ai/call-json";
import { claude, model } from "@/lib/ai/client";
import { extract } from "@/lib/ai/extract";
import { judge, JUDGE_EFFORT } from "@/lib/ai/judge";
import { GUARDRAIL_VERSION, JUDGE_PROMPT_VERSION, type ExtractOutput, type JudgeInput, type JudgeOutput, type JudgePhoto, type Result } from "@/lib/ai/types";
import { carrierStatus } from "@/lib/carrier";
import { decide, type Decision, type DecisionReason, type Limits } from "@/lib/deal/decide";
import { DealError } from "@/lib/deal/errors";
import { appendCodeCondition } from "@/lib/deal/terms";
import { hashCheck } from "@/lib/deal/verdict";
import { validateFile } from "@/lib/files/validate";

export const LIMITS: Limits = { passThreshold: 0.85, autoCaptureMaxMinor: 20000 }; // the literal limits of 05 section 9.3
const PRICES: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] }; // $ per MTok in / out (05 section 10)
const IMAGE = /\.(jpe?g|png|webp)$/i;
type Effort = "low" | "medium" | "high";

// ---- case folder contract (05 section 9.2) ----
export interface CaseDeal { code: string; amount_minor: number; fix_attempts_used: number; conditions: JudgeInput["conditions"]; note: string | null }
export interface Expected { group: string; decision: Decision; results?: Record<string, Result>; hash_match?: boolean }
export interface LoadedCase { name: string; deal: CaseDeal; expected: Expected; input: JudgeInput }

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const photos = (dir: string): JudgePhoto[] =>
  !existsSync(dir) ? [] : readdirSync(dir).filter((f) => IMAGE.test(f)).sort().map((f) => {
    const bytes = new Uint8Array(readFileSync(join(dir, f)));
    const { mime, sha256 } = validateFile(bytes); // the same sniff, size cap and hash as the upload route
    return { id: f, mime, sha256, bytes };
  });

export function loadCase(dir: string, name = dir.split("/").filter(Boolean).at(-1) ?? dir): LoadedCase {
  const deal = readJson<CaseDeal>(join(dir, "deal.json"));
  const expected = readJson<Expected>(join(dir, "expected.json"));
  const stored = appendCodeCondition(deal.code, deal.conditions).map((c) => c.text);
  if (stored.join("\n") !== deal.conditions.map((c) => c.text).join("\n")) throw new Error(`${name}: deal.json conditions must end with this deal's code condition, as lib/deal stores them (D6)`);
  const trackingPath = join(dir, "tracking.txt");
  const tracking_number = (existsSync(trackingPath) ? readFileSync(trackingPath, "utf8").trim() : "") || null;
  return {
    name, deal, expected,
    input: {
      code: deal.code, conditions: deal.conditions,
      reference_photos: photos(join(dir, "reference")), evidence_photos: photos(join(dir, "evidence")),
      tracking_number, carrier_status: tracking_number ? carrierStatus(tracking_number) : null,
      note: deal.note, submission_no: 1,
    },
  };
}

export const listCases = (root: string, only?: string): string[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!only || d.name.startsWith(only)))
    .map((d) => d.name).sort();

// ---- per-case evaluation (pure) ----
export interface CaseRow {
  name: string; group: string; expected: Decision; decision: Decision; reason: DecisionReason; match: boolean; wrong_capture: boolean;
  model: string; prompt_version: string; skipped: "hash_match" | null; guardrail_miss: boolean;
  verdicts: { condition_id: string; result: Result; confidence: number; expected: Result | null }[];
  latency_ms: number; usage: { input_tokens: number; output_tokens: number } | null; error: string | null; stop_category: string | null;
}

export function evaluateCase(output: JudgeOutput, expected: Expected, deal: CaseDeal, name = "case"): CaseRow {
  const { decision, reason } = decide(output.verdicts, deal, LIMITS);
  const raw = output.raw_response;
  const skipped = "skipped" in raw ? raw.skipped : null;
  return {
    name, group: expected.group, expected: expected.decision, decision, reason,
    match: decision === expected.decision,
    wrong_capture: decision === "capture" && expected.decision !== "capture",
    model: output.model, prompt_version: output.prompt_version, skipped,
    guardrail_miss: expected.hash_match !== undefined && expected.hash_match !== (skipped === "hash_match"),
    verdicts: output.verdicts.map((v) => ({ condition_id: v.condition_id, result: v.result, confidence: v.confidence, expected: expected.results?.[v.condition_id] ?? null })),
    latency_ms: raw.latency_ms,
    usage: "usage" in raw ? raw.usage : null,
    error: "error" in raw ? (raw.error?.kind ?? null) : null,
    stop_category: "stop_category" in raw ? raw.stop_category : null,
  };
}

export interface Summary {
  runs: number; matched: number; decision_match_rate: number;
  not_capture_runs: number; wrong_captures: number; wrong_capture_rate: number;
  by_group: Record<string, { matched: number; runs: number }>;
  flips: number; guardrail_misses: number;
  failures: Record<string, number>; refusals: number;
  latency_ms: { p50: number; p95: number; max: number };
  tokens: { mean_in: number; mean_out: number; est_cost_usd: number | null };
}

const pct = (n: number, d: number) => (d === 0 ? 0 : n / d);
const quantile = (xs: number[], q: number) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]!);

export function summarise(rows: CaseRow[], modelId = model()): Summary {
  const notCapture = rows.filter((r) => r.expected !== "capture");
  const by_group: Summary["by_group"] = {};
  for (const r of rows) {
    const g = (by_group[r.group] ??= { matched: 0, runs: 0 });
    g.runs++;
    if (r.match) g.matched++;
  }
  const decisions = new Map<string, Set<Decision>>();
  for (const r of rows) (decisions.get(r.name) ?? decisions.set(r.name, new Set()).get(r.name)!).add(r.decision);
  const failures: Record<string, number> = {};
  for (const r of rows) if (r.error) failures[r.error] = (failures[r.error] ?? 0) + 1;
  const latencies = rows.map((r) => r.latency_ms);
  const used = rows.flatMap((r) => (r.usage ? [r.usage] : []));
  const sumIn = used.reduce((a, u) => a + u.input_tokens, 0), sumOut = used.reduce((a, u) => a + u.output_tokens, 0);
  const price = PRICES[modelId];
  return {
    runs: rows.length, matched: rows.filter((r) => r.match).length, decision_match_rate: pct(rows.filter((r) => r.match).length, rows.length),
    not_capture_runs: notCapture.length, wrong_captures: notCapture.filter((r) => r.wrong_capture).length,
    wrong_capture_rate: pct(notCapture.filter((r) => r.wrong_capture).length, notCapture.length),
    by_group, flips: [...decisions.values()].filter((s) => s.size > 1).length, guardrail_misses: rows.filter((r) => r.guardrail_miss).length,
    failures, refusals: failures.refusal ?? 0, // 400 BadRequests are counted by counting() for the whole run, both jobs
    latency_ms: { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), max: Math.max(0, ...latencies) },
    tokens: { mean_in: Math.round(pct(sumIn, used.length)), mean_out: Math.round(pct(sumOut, used.length)), est_cost_usd: price ? (sumIn * price[0] + sumOut * price[1]) / 1e6 : null },
  };
}

// ---- extraction (05 section 9.2 "An extraction case matches when...") ----
export interface Sentence { name: string; today: string; sentence: string; expected: { error: string } | { amount_minor: number | null; currency: "USD" | null; deadline_days: number | null; photo: boolean; tracking: boolean; rejected_min: number } }
export interface ExtractRow { name: string; match: boolean; got: unknown; error: string | null; latency_ms: number; usage: CaseRow["usage"] }

export function evaluateExtract(s: Sentence, result: ExtractOutput | DealError): ExtractRow {
  const e = s.expected;
  if (result instanceof DealError) return { name: s.name, match: "error" in e && e.error === result.code, got: null, error: result.code, latency_ms: 0, usage: null };
  const got = {
    amount_minor: result.amount_minor, currency: result.currency, deadline_days: result.deadline_days,
    photo: result.conditions.some((c) => c.evidence_type === "photo"), tracking: result.conditions.some((c) => c.evidence_type === "tracking"), rejected: result.rejected.length,
  };
  const match = !("error" in e) && got.amount_minor === e.amount_minor && got.currency === e.currency && got.deadline_days === e.deadline_days
    && got.photo === e.photo && got.tracking === e.tracking && got.rejected >= e.rejected_min;
  return { name: s.name, match, got, error: null, latency_ms: result.raw_response.latency_ms, usage: result.raw_response.usage };
}

// ---- running ----
export interface RunOpts { client?: MessagesClient; effort?: Effort; concurrency?: number; repeats?: number; log?: (line: string) => void }
export interface Counters { calls: number; bad_requests: number; refusals: number }

/** Wraps the client so extraction (which hides AiError behind ai_unavailable) still reports 400s and refusals (05 section 10.3). */
export function counting(inner: MessagesClient): { client: MessagesClient; counters: Counters } {
  const counters: Counters = { calls: 0, bad_requests: 0, refusals: 0 };
  const client: MessagesClient = {
    messages: {
      create: async (params, opts) => {
        counters.calls++;
        try {
          const msg = await inner.messages.create(params, opts);
          if (msg.stop_reason === "refusal") counters.refusals++;
          return msg;
        } catch (err) {
          if ((err as { status?: number }).status === 400) counters.bad_requests++;
          throw err;
        }
      },
    },
  };
  return { client, counters };
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  }));
  return out;
}

const fmt = (r: CaseRow) =>
  `${r.name.padEnd(28)} ${r.expected.padEnd(13)} ${r.decision.padEnd(13)} ${r.match ? "ok      " : "MISMATCH"}${r.guardrail_miss ? " GUARDRAIL-MISS" : ""}  ` +
  `${(r.latency_ms / 1000).toFixed(1)}s  ${r.usage ? `${r.usage.input_tokens.toLocaleString()} in / ${r.usage.output_tokens.toLocaleString()} out` : r.skipped ?? r.error ?? ""}`;

/** hashCheck first, then judge, in the order of lib/deal/verdict.ts, so the byte-identical listing-reused cases never reach the model. */
export async function runCase(c: LoadedCase, opts: RunOpts = {}): Promise<CaseRow> {
  const out = hashCheck(c.input) ?? (await judge(c.input, opts.client ?? claude(), { effort: opts.effort ?? JUDGE_EFFORT }));
  return evaluateCase(out, c.expected, c.deal, c.name);
}

export async function runCases(cases: LoadedCase[], opts: RunOpts = {}): Promise<CaseRow[]> {
  const runs = Array.from({ length: opts.repeats ?? 1 }, () => cases).flat();
  return pool(runs, opts.concurrency ?? 3, async (c) => {
    const row = await runCase(c, opts);
    opts.log?.(fmt(row));
    return row;
  });
}

export async function runExtract(sentences: Sentence[], opts: RunOpts = {}): Promise<ExtractRow[]> {
  const client = opts.client ?? claude();
  return pool(sentences, opts.concurrency ?? 3, async (s) => {
    const result = await extract({ sentence: s.sentence, today: new Date(s.today) }, client).catch((err: unknown) => {
      if (err instanceof DealError) return err;
      throw err;
    });
    const row = evaluateExtract(s, result);
    opts.log?.(`${row.name.padEnd(28)} ${row.match ? "ok      " : "MISMATCH"}  ${row.error ?? JSON.stringify(row.got)}`);
    return row;
  });
}

export function printSummary(s: Summary, label: string, log: (line: string) => void): void {
  const p = (n: number) => `${(n * 100).toFixed(1)}%`;
  log(`verdict: ${label}, ${JUDGE_PROMPT_VERSION} (${GUARDRAIL_VERSION} on hash matches)`);
  log(`  decision match      ${s.matched}/${s.runs}   ${p(s.decision_match_rate)}`);
  log(`  wrong captures      ${s.wrong_captures}/${s.not_capture_runs}   ${p(s.wrong_capture_rate)}      (runs whose expected decision is not capture)`);
  log(`  by group            ${Object.entries(s.by_group).map(([g, v]) => `${g} ${v.matched}/${v.runs}`).join("  ")}`);
  log(`  flip rate           ${s.flips} cases changed decision between repeats; guardrail misses ${s.guardrail_misses}`);
  log(`  failures            ${["timeout", "api_error", "refusal", "schema_mismatch", "stop", "no_text", "bad_json"].map((k) => `${k} ${s.failures[k] ?? 0}`).join("  ")}`);
  log(`  latency             p50 ${(s.latency_ms.p50 / 1000).toFixed(1)}s  p95 ${(s.latency_ms.p95 / 1000).toFixed(1)}s  max ${(s.latency_ms.max / 1000).toFixed(1)}s`);
  log(`  tokens              mean ${s.tokens.mean_in.toLocaleString()} in / ${s.tokens.mean_out.toLocaleString()} out    est. cost ${s.tokens.est_cost_usd === null ? "n/a" : `$${s.tokens.est_cost_usd.toFixed(2)}`}`);
}

export interface ResultsFile {
  ran_at: string; model: string; effort: Effort; prompt_version: typeof JUDGE_PROMPT_VERSION; guardrail_version: typeof GUARDRAIL_VERSION;
  flags: Record<string, unknown>; counters: Counters; rows: CaseRow[]; summary: Summary; extract: { rows: ExtractRow[]; matched: number } | null;
}

export const resultsName = (modelId: string, effort: Effort, at = new Date()) =>
  `${at.toISOString().slice(0, 16).replace(/[-:T]/g, (ch) => (ch === "T" ? "-" : ""))}-${modelId}-${effort}.json`;

// ---- CLI ----
async function main(): Promise<void> {
  try { process.loadEnvFile(); } catch { /* .env is optional */ }
  const { values: flags } = parseArgs({
    options: {
      cases: { type: "string", default: "eval/cases" }, only: { type: "string" }, concurrency: { type: "string", default: "3" },
      effort: { type: "string", default: JUDGE_EFFORT }, repeats: { type: "string", default: "1" }, extract: { type: "boolean", default: false }, dry: { type: "boolean", default: false },
    },
  });
  const effort = flags.effort as Effort;
  if (!["low", "medium", "high"].includes(effort)) throw new Error(`--effort must be low, medium or high, not ${effort}`);
  const names = listCases(flags.cases, flags.only);
  const cases = names.map((n) => loadCase(join(flags.cases, n), n));
  const log = (line: string) => console.log(line);

  if (flags.dry) {
    for (const c of cases) {
      const { input } = c;
      const skip = hashCheck(input);
      log(`${c.name.padEnd(28)} expected ${c.expected.decision.padEnd(13)} ${skip ? `hash_match -> ${decide(skip.verdicts, c.deal, LIMITS).decision} (no model call)` : "would call the model"}`);
      log(`  conditions ${input.conditions.map((x, i) => `c${i + 1}=${x.id}:${x.evidence_type}`).join(" ")}`);
      log(`  reference  ${input.reference_photos.map((p, i) => `r${i + 1}=${p.id} ${p.mime} ${p.bytes.length}B`).join(", ") || "(none)"}`);
      log(`  evidence   ${input.evidence_photos.map((p, i) => `e${i + 1}=${p.id} ${p.mime} ${p.bytes.length}B`).join(", ") || "(none)"}`);
      log(`  tracking   ${input.tracking_number ?? "(none)"} -> ${input.carrier_status ?? "null"}   note ${input.note === null ? "null" : JSON.stringify(input.note)}`);
    }
    log(`dry run: ${cases.length} case(s) assembled on ${model()} @ ${effort}; no API call made.`);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set; use --dry to assemble inputs without calling the API.");
  const { client, counters } = counting(claude());
  const opts: RunOpts = { client, effort, concurrency: Number(flags.concurrency), repeats: Number(flags.repeats), log };
  const rows = await runCases(cases, opts);
  const summary = summarise(rows);
  log("");
  printSummary(summary, `${cases.length} cases x ${opts.repeats} repeats = ${rows.length} runs on ${model()} @ ${effort}`, log);

  let ex: ResultsFile["extract"] = null;
  if (flags.extract) {
    log("");
    const sentences = readJson<Sentence[]>("eval/extract/sentences.json");
    const exRows = await runExtract(sentences, opts);
    ex = { rows: exRows, matched: exRows.filter((r) => r.match).length };
    log(`extract: ${exRows.length} sentences on ${model()}: field match ${ex.matched}/${exRows.length}`);
  }
  log(`api: ${counters.calls} calls, ${counters.bad_requests} x 400 BadRequest, ${counters.refusals} refusals`);

  const file: ResultsFile = { ran_at: new Date().toISOString(), model: model(), effort, prompt_version: JUDGE_PROMPT_VERSION, guardrail_version: GUARDRAIL_VERSION, flags, counters, rows, summary, extract: ex };
  mkdirSync("eval/results", { recursive: true });
  const path = join("eval/results", resultsName(model(), effort));
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  log(`wrote ${path}`);
  if (summary.wrong_captures > 0) {
    console.error(`FAIL: ${summary.wrong_captures} wrong capture(s); the rate must be 0 (D12).`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
}
