// The pure parts of lib/client-upload (T-25): target-size maths, the skip rule, size copy, error copy.
import { describe, expect, it } from "vitest";
import { ApiError, errorCopy, formatBytes, needsDownscale, targetSize } from "@/lib/client-upload";

describe("targetSize", () => {
  it("scales the long edge to 1600 and keeps the ratio", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });
  it("never scales up", () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("needsDownscale", () => {
  it("skips a JPEG already within 1600 px and 2 MB", () => {
    expect(needsDownscale(1600, 1200, 1_000_000, "image/jpeg")).toBe(false);
  });
  it("re-encodes when too wide, too big, or a type the server refuses", () => {
    expect(needsDownscale(1601, 1200, 1_000_000, "image/jpeg")).toBe(true);
    expect(needsDownscale(1600, 1200, 2_097_153, "image/jpeg")).toBe(true);
    expect(needsDownscale(1600, 1200, 1_000_000, "image/gif")).toBe(true);
  });
});

describe("formatBytes", () => {
  it("rounds to KB under a megabyte and to one decimal MB above", () => {
    expect(formatBytes(421_888)).toBe("412 KB");
    expect(formatBytes(1_258_291)).toBe("1.2 MB");
    expect(formatBytes(10)).toBe("1 KB");
  });
});

describe("errorCopy", () => {
  it("maps the 08 section 4.4 codes and shows the server sentence for invalid_input", () => {
    expect(errorCopy(new ApiError("ai_unavailable", "The model did not answer; try again."))).toBe("The model didn't answer. Try again.");
    expect(errorCopy(new ApiError("file_too_large", ""))).toBe("That photo is over 2 MB. Choose a smaller one.");
    expect(errorCopy(new ApiError("invalid_input", "Set the amount and the deadline before accepting."))).toBe("Set the amount and the deadline before accepting.");
    expect(errorCopy(new ApiError("invalid_input", ""))).toBe("Check the highlighted fields.");
    expect(errorCopy(new TypeError("Failed to fetch"))).toBe("Something went wrong on our side. Try again.");
  });
});
