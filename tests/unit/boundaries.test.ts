// Import-graph boundaries (06 "Security checks", NFR-1; T-07 acceptance 4): no model output can reach a PayPal call.
// Reads lib/** from disk and checks runtime import/export-from specifiers; `import type` / `export type` lines are allowed anywhere.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const LIB = join(ROOT, "lib");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Runtime import targets of a file, as paths relative to the repo root (e.g. "lib/paypal/types"). */
function runtimeImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*(import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) {
    const clause = m[2] ?? "";
    const spec = m[3] ?? m[4];
    if (/^type\s/.test(clause)) continue; // import type { X } / export type { X }
    const target = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(ROOT, resolve(dirname(file), spec)) : null;
    if (target) out.push(target);
  }
  return out;
}

const files = walk(LIB);
const rel = (f: string) => relative(ROOT, f);
const importsFrom = (f: string, prefix: string) => runtimeImports(f).filter((t) => t.startsWith(prefix));

describe("import boundaries (lib/**)", () => {
  it("found the deal module", () => {
    expect(files.some((f) => rel(f) === "lib/deal/decide.ts")).toBe(true);
    expect(runtimeImports(join(LIB, "deal/types.ts"))).toContain("lib/paypal/types"); // the parser sees runtime re-exports
  });

  it("lib/deal/decide.ts imports nothing from lib/paypal/ or lib/ai/", () => {
    const f = join(LIB, "deal/decide.ts");
    expect(importsFrom(f, "lib/paypal")).toEqual([]);
    expect(importsFrom(f, "lib/ai")).toEqual([]);
  });

  it("the pure deal core (transitions, facts, tick-select, keys, code, terms, dates) imports nothing from lib/paypal/ or lib/ai/", () => {
    for (const name of ["transitions", "facts", "tick-select", "keys", "code", "terms", "dates"]) {
      const f = join(LIB, `deal/${name}.ts`);
      expect(importsFrom(f, "lib/paypal"), rel(f)).toEqual([]);
      expect(importsFrom(f, "lib/ai"), rel(f)).toEqual([]);
    }
  });

  it("lib/ai/** imports nothing from lib/paypal/** and nothing from lib/deal/** except lib/deal/errors", () => {
    for (const f of files.filter((x) => rel(x).startsWith("lib/ai/"))) {
      expect(importsFrom(f, "lib/paypal"), rel(f)).toEqual([]);
      expect(importsFrom(f, "lib/deal").filter((t) => t !== "lib/deal/errors"), rel(f)).toEqual([]);
    }
  });

  it("only lib/deal/** (and lib/paypal itself, lib/deps.ts) imports lib/paypal/** at runtime", () => {
    const offenders = files
      .filter((f) => !/^lib\/(deal|paypal)\//.test(rel(f)) && rel(f) !== "lib/deps.ts")
      .filter((f) => importsFrom(f, "lib/paypal").length > 0)
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
