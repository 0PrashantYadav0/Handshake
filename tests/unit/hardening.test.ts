// T-45 follow-ups: security headers and the negative cert cache.
import { describe, expect, it, vi } from "vitest";
import nextConfig from "@/next.config";
import { buildCsp, newNonce } from "@/lib/csp";
import { clearCertCache, verifyPaypalSignature } from "@/lib/paypal/verify";

describe("security headers", () => {
  it("every route gets nosniff, referrer policy, frame denial and a permissions policy", async () => {
    const rules = await nextConfig.headers!();
    const names = rules[0].headers.map((h) => h.key);
    expect(rules[0].source).toBe("/:path*");
    expect(names).toEqual(expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"]));
  });
});

describe("cert fetch negative cache", () => {
  it("a failed fetch is not retried for the same URL within the window", async () => {
    clearCertCache();
    const fetchCert = vi.fn().mockRejectedValue(new Error("down"));
    const headers = {
      "paypal-transmission-id": "t",
      "paypal-transmission-time": "2026-10-20T10:00:00Z",
      "paypal-transmission-sig": "c2ln",
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "paypal-auth-algo": "SHA256withRSA",
    };
    const first = await verifyPaypalSignature({ headers, rawBody: "{}", webhookId: "WEBHOOK_ID", fetchCert });
    const second = await verifyPaypalSignature({ headers, rawBody: "{}", webhookId: "WEBHOOK_ID", fetchCert });
    expect(first.result).toBe("fetch_failed");
    expect(second.result).toBe("fetch_failed");
    expect(fetchCert).toHaveBeenCalledTimes(1);
    clearCertCache();
  });
});

describe("content security policy (H-2)", () => {
  const dir = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " "));
  it("scripts only with the nonce (plus what they load), no eval in production, no plugins, no framing", () => {
    const csp = buildCsp("abc123");
    expect(dir(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://*.paypal.com");
    expect(csp).not.toContain("unsafe-eval");
    expect(dir(csp, "script-src")).not.toContain("unsafe-inline");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("development adds only unsafe-eval (React's overlay) and drops the https upgrade for localhost", () => {
    const csp = buildCsp("n", { dev: true });
    expect(dir(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
  it("a plain-http production run (APP_URL http://…) does not upgrade subresources to https", () => {
    expect(buildCsp("n", { https: false })).not.toContain("upgrade-insecure-requests");
    expect(buildCsp("n", { https: false })).not.toContain("unsafe-eval");
  });
  it("nonces are 128-bit and differ per call", () => {
    const a = newNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});
