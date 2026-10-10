// T-05 acceptance 4: overrideDeps is referenced by no file under app/ or lib/ except lib/deps.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  } catch {
    return [];
  }
}

test("overrideDeps is only referenced by lib/deps.ts", () => {
  const offenders = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]
    .filter((p) => readFileSync(p, "utf8").includes("overrideDeps"))
    .map((p) => relative(ROOT, p));
  expect(offenders).toEqual(["lib/deps.ts"]);
});
