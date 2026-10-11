// trust spec §6: accepting is signing. Every way a signature can be wrong is refused and writes nothing.
import { beforeEach, describe, expect, test } from "vitest";
import { POST as acceptRoute } from "@/app/api/deals/[code]/accept/route";
import { POST as revokeRoute } from "@/app/api/keys/[id]/revoke/route";
import { getDeal, handle } from "@/lib/deal";
import { signingMessage } from "@/lib/contract/canonical";
import { totpAt } from "@/lib/auth/totp";
import { prisma } from "@/lib/db";
import type { DealView } from "@/lib/deal/types";
import {
  callRoute, dealBuilder, enrollTotp, events, expectError, parties, resetDb, signedAccept, signHash, signIn, testDeps, testKeyFor,
  type Parties, type TestDeps,
} from "./helpers";

const withoutType = <T extends { type: string }>({ type: _type, ...rest }: T) => (void _type, rest);
let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});

const sigRows = (code: string) => prisma.contractSignature.findMany({ where: { deal: { public_code: code } }, orderBy: { signed_at: "asc" } });

describe("signing", () => {
  test("both signatures agree the terms; rows, keys, events and the view carry the hash", async () => {
    const code = await build.joined();
    const before = (await getDeal(code, p.asBuyer, deps)) as DealView;
    expect(before.contract?.document).toMatchObject({ code, terms_version: 1, buyer: { id: p.buyer.id }, seller: { id: p.seller.id } });
    const hash = before.contract!.hash;

    await handle(code, p.asSeller, await signedAccept(code, p.asSeller), deps);
    const v = await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer), deps);
    expect(v.status).toBe("terms_agreed");
    expect(v.contract!.signatures.map((s) => s.role).sort()).toEqual(["buyer", "seller"]);
    expect(v.contract!.signatures.every((s) => s.contract_hash === hash)).toBe(true);

    const rows = await sigRows(code);
    expect(rows).toHaveLength(2);
    expect(await prisma.signingKey.count()).toBe(2);
    const accepts = (await events(code)).filter((e) => e.cause === "accept");
    expect(accepts.map((e) => e.payload)).toEqual([
      { terms_version: 1, contract_hash: hash, key_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { terms_version: 1, contract_hash: hash, key_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  test("before the seller joins there is no contract and nobody can sign", async () => {
    const code = await build.draft();
    expect(((await getDeal(code, p.asBuyer, deps)) as DealView).contract).toBeNull();
    const e = await expectError(handle(code, p.asBuyer, await signedAccept(code, p.asBuyer), deps), "invalid_state");
    expect(e.message).toMatch(/seller has joined/);
  });

  test("a hash from another version, a tampered signature, or someone else's key: signature_invalid, nothing written", async () => {
    const code = await build.joined();
    const good = await signedAccept(code, p.asSeller);
    const wrongHash = "f".repeat(64);
    await expectError(handle(code, p.asSeller, { ...good, contract_hash: wrongHash, ...(await signHash(await testKeyFor(p.seller.id), wrongHash)) }, deps), "signature_invalid");
    const bad = good.signature.slice(0, 10) + (good.signature[10] === "A" ? "B" : "A") + good.signature.slice(11);
    await expectError(handle(code, p.asSeller, { ...good, signature: bad }, deps), "signature_invalid");
    // signed with the seller's key but presenting the third party's public key
    const other = await signHash(await testKeyFor(p.third.id), good.contract_hash);
    await expectError(handle(code, p.asSeller, { ...good, public_key: other.public_key }, deps), "signature_invalid");
    expect(await sigRows(code)).toHaveLength(0);
    expect((await prisma.deal.findUniqueOrThrow({ where: { public_code: code } })).seller_accepted_version).toBeNull();
  });

  test("a key registered by one user cannot sign for another", async () => {
    const code = await build.joined();
    await handle(code, p.asSeller, await signedAccept(code, p.asSeller), deps); // registers the seller's key
    const hash = ((await getDeal(code, p.asBuyer, deps)) as DealView).contract!.hash;
    const stolen = await signHash(await testKeyFor(p.seller.id), hash);
    const e = await expectError(handle(code, p.asBuyer, { type: "accept", terms_version: 1, contract_hash: hash, ...stolen }, deps), "signature_invalid");
    expect(e.message).toMatch(/another account/);
  });

  test("editing the terms needs fresh signatures; the old ones stay on record for the old version", async () => {
    const code = await build.joined();
    await handle(code, p.asSeller, await signedAccept(code, p.asSeller), deps);
    const v2 = await handle(code, p.asBuyer, { type: "edit_terms", item_title: "Jacket", amount_minor: 9000, deadline_days: 10, conditions: [{ text: "Matches the photos", evidence_type: "photo" }] }, deps);
    expect(v2.terms_version).toBe(2);
    expect(v2.contract!.signatures).toEqual([]);
    const stale = await signedAccept(code, p.asSeller, 2);
    await prisma.deal.update({ where: { public_code: code }, data: { amount_minor: 9001 } }); // terms moved under the signer
    await expectError(handle(code, p.asSeller, stale, deps), "signature_invalid");
    expect((await sigRows(code)).map((r) => r.terms_version)).toEqual([1]);
  });

  test("signatures are append-only in the database", async () => {
    const code = await build.agreed();
    const [row] = await sigRows(code);
    await expect(prisma.$executeRawUnsafe(`UPDATE contract_signatures SET contract_hash = '${"0".repeat(64)}' WHERE id = '${row!.id}'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM contract_signatures WHERE id = '${row!.id}'`)).rejects.toThrow(/append-only/);
  });
});

describe("over HTTP", () => {
  test("accept needs a fresh authenticator code; without one nothing is signed", async () => {
    const code = await build.joined();
    const secret = await enrollTotp(p.seller.id);
    const cookie = await signIn(p.seller.id);
    const signed = withoutType(await signedAccept(code, p.asSeller));
    const call = (body: unknown) => callRoute(acceptRoute as never, "POST", `/api/deals/${code}/accept`, { cookie, body, params: { code } });
    const none = await call(signed);
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("totp_invalid");
    const bad = await call({ ...signed, signature: "x" });
    expect(bad.status).toBe(400);
    expect(await sigRows(code)).toHaveLength(0);
    const ok = await call({ ...signed, totp: totpAt(secret, deps.clock.now().getTime()) });
    expect(ok.status).toBe(200);
    expect(await sigRows(code)).toHaveLength(1);
  });

  test("a revoked key can no longer sign; revoking needs step-up and only touches your own keys", async () => {
    const code = await build.joined();
    await handle(code, p.asSeller, await signedAccept(code, p.asSeller), deps);
    const key = await prisma.signingKey.findFirstOrThrow({ where: { user_id: p.seller.id } });
    const secret = await enrollTotp(p.seller.id);
    const revoke = (cookie: string, totp: string) => callRoute(revokeRoute as never, "POST", `/api/keys/${key.id}/revoke`, { cookie, body: { totp }, params: { id: key.id } });
    expect((await revoke(await signIn(p.seller.id), "000000")).status).toBe(400);
    const buyerSecret = await enrollTotp(p.buyer.id);
    expect((await revoke(await signIn(p.buyer.id), totpAt(buyerSecret, deps.clock.now().getTime()))).status).toBe(409);
    const res = await revoke(await signIn(p.seller.id), totpAt(secret, deps.clock.now().getTime()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { keys: { revoked_at: string | null }[] }).keys[0]!.revoked_at).not.toBeNull();

    await handle(code, p.asBuyer, { type: "edit_terms", item_title: "Jacket", amount_minor: 9000, deadline_days: 10, conditions: [{ text: "Matches the photos", evidence_type: "photo" }] }, deps);
    const e = await expectError(handle(code, p.asSeller, await signedAccept(code, p.asSeller, 2), deps), "signature_invalid");
    expect(e.message).toMatch(/revoked/);
    expect(signingMessage("ab")).toBe("Handshake contract v2\nab");
  });
});
