// T-45 follow-ups: security headers and the negative cert cache.
import { describe, expect, it, vi } from "vitest";
import nextConfig from "@/next.config";
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
