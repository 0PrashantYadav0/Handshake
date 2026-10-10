// Every bullet of 06 "Signed file URLs" (B6; 02 section 9.3).
import { describe, expect, it } from "vitest";
import { signFileUrl, verifyFileUrl } from "@/lib/files/urls";

const SECRET = "file-url-secret-for-tests-at-least-32-chars";
const NOW = new Date("2026-10-20T10:00:00Z");
const ID = "f1d0a9b8-1c2d-4e3f-8a4b-5c6d7e8f9a01";

function parts(url: string) {
  const u = new URL(url, "http://localhost");
  return { id: u.pathname.split("/").at(-1)!, exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
}

describe("signed file URLs", () => {
  const url = signFileUrl(ID, 600, NOW, SECRET);
  const { exp, sig } = parts(url);

  it("mints /api/files/{id}?exp=&sig= with exp 600 s ahead", () => {
    expect(url.startsWith(`/api/files/${ID}?exp=`)).toBe(true);
    expect(exp).toBe(String(Math.floor(NOW.getTime() / 1000) + 600));
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("a fresh URL verifies", () => {
    expect(verifyFileUrl(ID, exp, sig, NOW, SECRET)).toBe(true);
    expect(verifyFileUrl(ID, exp, sig, new Date(NOW.getTime() + 600_000), SECRET)).toBe(true); // at exp still valid
  });
  it("exp one second in the past -> false", () => {
    expect(verifyFileUrl(ID, exp, sig, new Date(NOW.getTime() + 601_000), SECRET)).toBe(false);
  });
  it("another file id with the same sig -> false", () => {
    expect(verifyFileUrl("f2e1b0c9-2d3e-4f40-9b5c-6d7e8f9a0b12", exp, sig, NOW, SECRET)).toBe(false);
  });
  it("sig with one character changed -> false", () => {
    const flipped = (sig![0] === "A" ? "B" : "A") + sig!.slice(1);
    expect(verifyFileUrl(ID, exp, flipped, NOW, SECRET)).toBe(false);
  });
  it("sig shorter than expected -> false and no throw", () => {
    expect(verifyFileUrl(ID, exp, sig!.slice(0, -1), NOW, SECRET)).toBe(false);
    expect(verifyFileUrl(ID, exp, "", NOW, SECRET)).toBe(false);
  });
  it("exp not all digits, or exp/sig missing -> false", () => {
    expect(verifyFileUrl(ID, "17925e3", sig, NOW, SECRET)).toBe(false);
    expect(verifyFileUrl(ID, null, sig, NOW, SECRET)).toBe(false);
    expect(verifyFileUrl(ID, exp, null, NOW, SECRET)).toBe(false);
  });
  it("same URL verified with a different secret -> false", () => {
    expect(verifyFileUrl(ID, exp, sig, NOW, "another-secret-of-at-least-32-characters-x")).toBe(false);
  });
  it("reads FILE_URL_SECRET when no secret is given", () => {
    process.env.FILE_URL_SECRET = SECRET;
    const u = parts(signFileUrl(ID, 600, NOW));
    expect(verifyFileUrl(ID, u.exp, u.sig, NOW)).toBe(true);
  });
});
