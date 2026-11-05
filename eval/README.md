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
