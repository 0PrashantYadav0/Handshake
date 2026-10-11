// Per-user read limit on GET /api/deals/{code} (T-45: draft-preview enumeration).
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/deals/[code]/route";
import { makeUser, resetDb, signIn } from "./helpers";

describe("GET /api/deals/{code} rate limit", () => {
  beforeEach(resetDb);

  it("answers 429 rate_limited after 120 reads in ten minutes, per user", async () => {
    const u = await makeUser("reader@test");
    const cookie = await signIn(u.id);
    const call = () => GET(new Request("http://x/api/deals/HS-ZZZZ", { headers: { cookie } }), { params: Promise.resolve({ code: "HS-ZZZZ" }) });
    for (let i = 0; i < 120; i++) expect((await call()).status).toBe(404);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("rate_limited");
    const other = await makeUser("other@test");
    const res = await GET(new Request("http://x/api/deals/HS-ZZZZ", { headers: { cookie: await signIn(other.id) } }), { params: Promise.resolve({ code: "HS-ZZZZ" }) });
    expect(res.status).toBe(404);
  });
});
