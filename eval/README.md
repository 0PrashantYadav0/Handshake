# Eval

Thirty verdict cases and ten extraction sentences (05-ai-spec section 9, D12). `npm run eval` prints the decision-match rate and the wrong-capture rate; the second must be 0 or the runner exits 1.

The photos are path-traced renders of eight original items, made by `scripts/demo/photo-studio/` (`node scripts/demo/photo-studio/eval-cases.mjs`), in place of the eight photographed household items of 05 section 9.1. Each item has marks that tell it apart, and the wrong-item cases change colour, model or the whole item.

## Run

```
npm run eval                                   # all of eval/cases/, claude-sonnet-5-5 (or AI_MODEL) at low, 3 in flight
npm run eval -- --only correct-                # one case or a group prefix
npm run eval -- --effort medium --repeats 3    # challenger config; flip rate needs repeats
npm run eval -- --extract                      # also run eval/extract/sentences.json through extract()
npm run eval -- --dry --cases tests/fixtures/eval   # assemble inputs, apply the D8 hash check, no API call
AI_MODEL=claude-opus-5-5 npm run eval          # challenger model (05 section 9.4)
```

Flags: `--cases <dir>` (default `eval/cases`), `--only <prefix>`, `--concurrency <n>` (3), `--effort low|medium|high` (low), `--repeats <n>` (1), `--extract`, `--dry`. Needs `ANTHROPIC_API_KEY` in `.env` unless `--dry`. Each live run writes `eval/results/<YYYYMMDD-HHMM>-<model>-<effort>.json` (flags, prompt versions, every row, the summary, call counters for 400s and refusals); commit it.

## Add a case

```
eval/cases/<group>-<nn>-<item>/
  deal.json        { code, amount_minor, fix_attempts_used, conditions: [{ id, text, evidence_type }], note }
  reference/       01.jpg 02.jpg ...  -> r1, r2 (sorted by filename; empty or absent = no listing photos)
  evidence/        01.jpg 02.jpg ...  -> e1, e2 (sorted by filename); jpg, png or webp, at most 2 MB each
  tracking.txt     the tracking number; absent or empty = none (carrier status comes from lib/carrier.ts)
  expected.json    { group, decision, results?: { c1: "pass", ... }, hash_match?: true }
```

Groups, counts and expected decisions: 05-ai-spec section 9.1. Condition ids are the labels `c1`..`c5`; the code condition is last, as `lib/deal` stores it (the loader rejects a folder where it is not). `expected.results` only feeds the per-condition column. `expected.hash_match: true` marks the two byte-identical `listing-reused` cases: the runner flags `GUARDRAIL-MISS` if the model was called for them.

`tests/fixtures/eval/fixture-01-synthetic/` is a fixture for `tests/unit/eval-run.test.ts` (1x1 generated PNGs), not an eval case; never copy it into `eval/cases/`.

## Measured (05 section 10.3)

Baseline: `npm run eval -- --repeats 3` on `claude-sonnet-5-5` at low, 2026-11-05, `eval/results/20261105-1819-claude-sonnet-5-5-low.json`.

| Item | Result |
| --- | --- |
| Decision match | 87 of 90 runs (96.7%). The misses are all `correct-08-planter`: Claude passes the item at 0.80, under the 0.85 threshold, so the buyer decides. That is the safe direction |
| Wrong captures | 0 of 63 |
| Verdict latency, all runs | p50 3.5 s, p95 4.8 s, max 5.3 s. D4 moved to 9 s with one retry |
| Verdict latency, 10 images | 4.2 to 4.9 s (`correct-08-planter`) |
| Token count, 10 images | About 18,600 input tokens |
| Image size | 120 of the 121 eval images are 1280 x 960 (one is 1100 x 840). The app sends up to 1600 px on the long edge (`lib/client-upload.ts`) and the demo kit's photos are 1600 x 1200, so the token and latency rows understate a full-size request. A 10-image request at 1600 px was not measured |
| Flip rate between repeats | 0 cases |
| Refusals, 400s from the schema | 0, 0 |
| Cost | $1.73 for 90 runs |
| Rate limits | From the `anthropic-ratelimit-*` headers of one `claude-sonnet-5-5` call, 2026-11-06: 4,000 requests, 2,000,000 input tokens, 400,000 output tokens. The headers name no window or tier; `docs/research/claude-api.md` section 9 lists these limits per minute. `--concurrency 3` never hit one |
| Schema changes | `correct-01-mug`, one run each, a single sample, 2026-11-06: 4.4 s unchanged, 4.1 s with one character changed in a `description`, 5.4 s with one value added to an `enum`. The `description` change shows no compile cost, which fits `docs/research/claude-api.md` section 3: only a change of structure invalidates the grammar. The `enum` change is a change of structure and took about 1 s longer; one sample can't separate that from the spread (this case's other warm runs took 3.2 to 4.4 s). Neither reading is a 24 h idle. Result files for these runs are not committed |
| Not measured | Cold grammar compile after 24 h idle, medium effort, Opus, Haiku's image tier |

The first run, `eval/results/20261105-1809-claude-sonnet-5-5-low.json`, is kept on purpose. It shows two wrong captures, `blurry-02-book` and `blurry-03-keyboard`. Both traced to test photos that did not match their case: the "half out of frame" book was nearly all in frame and the "too dark" keyboard could be seen clearly in one photo, so `pass` was the right answer. Those photos were re-rendered, with `blurry-01`'s depth of field, before the baseline. The prompt and the model did not change.
