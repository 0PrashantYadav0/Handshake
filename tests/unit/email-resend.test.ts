// lib/email resendEmail: demo persona addresses never reach Resend (they would bounce); real addresses do.
import { afterEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string }[]);
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async (m: { to: string }) => (sent.push(m), { error: null }) };
  },
}));

import { resendEmail } from "@/lib/email";

afterEach(() => { sent.length = 0; vi.restoreAllMocks(); });

describe("resendEmail", () => {
  it("logs mail to a demo persona instead of sending it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await resendEmail("re_test", "Handshake <a@b.c>").send({ to: "demo-seller@handshake.demo", subject: "s", text: "t" });
    expect(sent).toHaveLength(0);
    expect(log).toHaveBeenCalledOnce();
  });

  it("sends mail to anyone else", async () => {
    await resendEmail("re_test", "Handshake <a@b.c>").send({ to: "someone@example.com", subject: "s", text: "t" });
    expect(sent.map((m) => m.to)).toEqual(["someone@example.com"]);
  });
});
