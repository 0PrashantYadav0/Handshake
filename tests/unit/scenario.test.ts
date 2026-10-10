// scripts/sandbox/scenario.ts: the pure halves (arg parsing, step planning, trail check, fixture pick). No HTTP.
import { describe, expect, it } from "vitest";
import { HELD_TRAIL, PAID_TRAIL, parseScenarioArgs, pickFixture, plan, trailMismatch } from "../../scripts/sandbox/scenario";

describe("parseScenarioArgs()", () => {
  it("defaults base to localhost:3000 and strips a trailing slash", () => {
    expect(parseScenarioArgs(["SB-1"]).flags.base).toBe("http://localhost:3000");
    expect(parseScenarioArgs(["SB-6", "--base", "https://x.onrender.com/"]).flags.base).toBe("https://x.onrender.com");
  });
  it("reads the flags of the 06 table", () => {
    const { id, flags } = parseScenarioArgs(["SB-1", "--dry", "--wait", "--full", "--upload", "--set", "blurry", "--seller-email", "s@example.com"]);
    expect(id).toBe("SB-1");
    expect(flags).toMatchObject({ dry: true, wait: true, full: true, upload: true, set: "blurry", "seller-email": "s@example.com" });
  });
  it("rejects an unknown scenario and SB-7 without --code", () => {
    expect(() => parseScenarioArgs(["SB-2"])).toThrow(/scenario must be one of/);
    expect(() => parseScenarioArgs(["SB-7"])).toThrow(/--code/);
    expect(parseScenarioArgs(["SB-7", "--code", "HS-ABCD"]).flags.code).toBe("HS-ABCD");
  });
});

describe("plan()", () => {
  it("SB-1 stops at held unless --full, and --wait swaps the poll for a pause", () => {
    const short = plan("SB-1", parseScenarioArgs(["SB-1"]).flags);
    expect(short.at(-1)).toMatch(/assert status held/);
    expect(short.some((s) => s.startsWith("poll:"))).toBe(true);
    const full = plan("SB-1", parseScenarioArgs(["SB-1", "--full", "--wait"]).flags);
    expect(full.at(-1)).toMatch(/11-row trail/);
    expect(full.some((s) => s.startsWith("PAUSE: approve"))).toBe(true);
  });
  it("SB-6 never confirms by API and asserts the webhook source", () => {
    const steps = plan("SB-6", parseScenarioArgs(["SB-6"]).flags).join("\n");
    expect(steps).toMatch(/never calls payment\/authorize/);
    expect(steps).toMatch(/"webhook"/);
  });
  it("every scenario has a plan ending in an assertion", () => {
    for (const id of ["SB-1", "SB-6", "SB-7", "SB-8", "SB-11"] as const) {
      expect(plan(id, parseScenarioArgs([id, "--code", "HS-2222"]).flags).at(-1)).toMatch(/^assert/);
    }
  });
});

describe("trailMismatch()", () => {
  it("accepts a prefix match and names the first difference", () => {
    expect(trailMismatch(HELD_TRAIL, HELD_TRAIL)).toBeNull();
    expect(trailMismatch(PAID_TRAIL, HELD_TRAIL)).toBeNull();
    expect(trailMismatch(HELD_TRAIL, PAID_TRAIL)).toBe("event 7: expected submit_evidence, got nothing");
    expect(trailMismatch(["create", "accept"], HELD_TRAIL)).toBe("event 2: expected join, got accept");
  });
  it("the paid trail is the 11-row trail of 06 SB-1", () => {
    expect(PAID_TRAIL).toHaveLength(11);
  });
});

describe("pickFixture()", () => {
  const rec = (id: string, cap: string) => JSON.stringify({ headers: { "paypal-transmission-id": "t" }, raw_body: JSON.stringify({ id, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: cap } }) });
  it("returns the PAYMENT.CAPTURE.COMPLETED recording naming the capture id, ignoring other event types", () => {
    const files = [
      { name: "PAYMENT.AUTHORIZATION.CREATED.1.json", text: rec("WH-A", "CAP-1") },
      { name: "PAYMENT.CAPTURE.COMPLETED.1.json", text: rec("WH-1", "CAP-9") },
      { name: "PAYMENT.CAPTURE.COMPLETED.2.json", text: rec("WH-2", "CAP-1") },
      { name: "cert.pem", text: "not json" },
    ];
    expect(pickFixture(files, "CAP-1")?.name).toBe("PAYMENT.CAPTURE.COMPLETED.2.json");
    expect(pickFixture(files, "CAP-10")).toBeNull();
  });
});
