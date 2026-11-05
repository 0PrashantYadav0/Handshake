// Pure parts of lib/demo-kit.ts plus a check that public/demo/presets.json points at files that exist (08 section 12.1).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chips, findPreset, type Presets } from "@/lib/demo-kit";

const kit = JSON.parse(readFileSync(join(process.cwd(), "public/demo/presets.json"), "utf8")) as Presets;
const pub = (p: string) => join(process.cwd(), "public", p);

describe("presets.json", () => {
  it("has the three presets, two extras, the tracking number and the font", () => {
    expect(kit.presets.map((p) => p.id)).toEqual(["mug", "lamp", "bottle"]);
    expect(kit.extras.map((e) => e.preset)).toEqual(["mug", "mug"]);
    expect(kit.tracking_number).toBe("TRK-DEMO-0000");
    expect(existsSync(pub(kit.font))).toBe(true);
    expect(existsSync(pub("/demo/fonts/OFL.txt"))).toBe(true);
  });

  it("points only at files that exist", () => {
    const urls = kit.presets.flatMap((p) => [...p.reference, p.code_photo.base, ...Object.values(p.sets).flatMap((s) => [...s.photos, ...(s.code_photo ? [s.code_photo.base] : [])])]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => !existsSync(pub(u)))).toEqual([]);
  });

  it("reuse-listing stages a reference photo with the client check skipped (D8)", () => {
    const mug = kit.presets[0];
    expect(mug.sets["reuse-listing"].photos).toEqual([mug.reference[0]]);
    expect(mug.sets["reuse-listing"].skip_listing_check).toBe(true);
  });
});

describe("chips", () => {
  it("lists presets then extras with only id, label, sentence", () => {
    const c = chips(kit);
    expect(c.map((x) => x.id)).toEqual(["mug", "lamp", "bottle", "mug-over-limit", "mug-subjective"]);
    expect(Object.keys(c[0])).toEqual(["id", "label", "sentence"]);
  });
});

describe("findPreset", () => {
  it("matches a preset sentence after trimming", () => {
    expect(findPreset(kit, `  ${kit.presets[1].sentence}\n`).id).toBe("lamp");
  });
  it("resolves an extra to its preset", () => {
    expect(findPreset(kit, kit.extras[0].sentence).id).toBe("mug");
  });
  it("finds the item in a sentence whose price was negotiated", () => {
    expect(findPreset(kit, "I'll pay $33 for the wooden desk lamp if it arrives within 7 days").id).toBe("lamp");
  });
  it("falls back to the first preset for an edited sentence", () => {
    expect(findPreset(kit, "I'll pay $9 for a hat").id).toBe("mug");
  });
});
