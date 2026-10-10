// 06 "Audit log": deal_events is append-only at the database level (03 constraints migration).
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dealBuilder, parties, resetDb, testDeps } from "./helpers";

describe("deal_events append-only trigger", () => {
  beforeEach(resetDb);

  it("UPDATE and DELETE raise; TRUNCATE (used by resetDb) still works", async () => {
    const deps = testDeps();
    const p = await parties();
    await dealBuilder(deps, p).draft();
    await expect(prisma.$executeRawUnsafe(`UPDATE "deal_events" SET cause = 'x'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "deal_events"`)).rejects.toThrow(/append-only/);
    expect(await prisma.dealEvent.count()).toBe(1);
    await resetDb();
    expect(await prisma.dealEvent.count()).toBe(0);
  });
});
