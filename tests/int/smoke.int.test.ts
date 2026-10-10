import { beforeEach, expect, test } from "vitest";
import { makeUser, resetDb, testDeps } from "./helpers";

beforeEach(resetDb);

test("connects, resets, inserts a user and reads it back", async () => {
  const { db } = testDeps();
  const user = await makeUser("buyer@test", { display_name: "Buyer" });
  const found = await db.user.findUnique({ where: { email: "buyer@test" } });
  expect(found?.id).toBe(user.id);
  expect(found?.display_name).toBe("Buyer");
  expect(await db.user.count()).toBe(1);
});
