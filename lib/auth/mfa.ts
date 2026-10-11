// Second factor state (trust spec §4): enrollment, sign-in verification, step-up, recovery codes.
// Every check consumes what it accepts in one conditional UPDATE, so a code or a recovery code works once even under a race.
import type { PrismaClient } from "@/generated/prisma/client";
import { aad, open, seal } from "@/lib/crypto/seal";
import { DealError } from "@/lib/deal/errors";
import { allow, peek } from "@/lib/rate-limit";
import { hashRecovery, newRecoveryCodes, newTotpSecret, normaliseRecovery, otpauthUri, verifyTotp } from "./totp";

const FAIL_LIMIT = 5;
const FAIL_WINDOW_MS = 10 * 60_000;
const binding = (userId: string) => aad("users.totp_secret", userId);

export type MfaStatus = { enabled: boolean; enabled_at: string | null; recovery_codes_left: number };

export async function mfaStatus(userId: string, db: PrismaClient): Promise<MfaStatus> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totp_enabled_at: true, recovery_codes: true } });
  if (!u) throw new DealError("not_signed_in");
  return { enabled: u.totp_enabled_at !== null, enabled_at: u.totp_enabled_at?.toISOString() ?? null, recovery_codes_left: u.recovery_codes.length };
}

/** A new pending secret, replacing any earlier pending one. Refused once 2FA is on. */
export async function startSetup(userId: string, db: PrismaClient): Promise<{ secret: string; otpauth_uri: string }> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, totp_enabled_at: true } });
  if (!u) throw new DealError("not_signed_in");
  if (u.totp_enabled_at) throw new DealError("invalid_state", "Two-factor auth is already on.");
  const secret = newTotpSecret();
  await db.user.update({ where: { id: userId }, data: { totp_secret: seal(secret, binding(userId)), totp_last_step: null } });
  return { secret, otpauth_uri: otpauthUri(secret, u.email) };
}

/** Confirms the pending secret with its first code; returns the recovery codes, shown once. */
export async function enableTotp(userId: string, code: string, db: PrismaClient, now: Date): Promise<string[]> {
  limitFailures(userId, now);
  const u = await db.user.findUnique({ where: { id: userId }, select: { totp_secret: true, totp_enabled_at: true } });
  if (!u) throw new DealError("not_signed_in");
  if (u.totp_enabled_at) throw new DealError("invalid_state", "Two-factor auth is already on.");
  if (!u.totp_secret) throw new DealError("invalid_state", "Start the setup first.");
  const step = verifyTotp(open(u.totp_secret, binding(userId)), code, now.getTime(), null);
  if (step === null) fail(userId, now);
  const codes = newRecoveryCodes();
  const done = await db.user.updateMany({
    where: { id: userId, totp_enabled_at: null, totp_secret: u.totp_secret },
    data: { totp_enabled_at: now, totp_last_step: step, recovery_codes: codes.map(hashRecovery) },
  });
  if (done.count !== 1) throw new DealError("invalid_state", "The setup changed; start again.");
  return codes;
}

/** A fresh TOTP code, consumed. Used at sign-in and for step-up (signing, payout email, key revoke). */
export async function checkTotp(userId: string, code: string, db: PrismaClient, now: Date): Promise<void> {
  limitFailures(userId, now);
  const u = await db.user.findUnique({ where: { id: userId }, select: { totp_secret: true, totp_enabled_at: true, totp_last_step: true } });
  if (!u) throw new DealError("not_signed_in");
  if (!u.totp_enabled_at || !u.totp_secret) throw new DealError("mfa_required", "Turn on two-factor auth first.");
  const step = verifyTotp(open(u.totp_secret, binding(userId)), code.replace(/\s/g, ""), now.getTime(), u.totp_last_step);
  if (step === null) fail(userId, now);
  const used = await db.user.updateMany({
    where: { id: userId, OR: [{ totp_last_step: null }, { totp_last_step: { lt: step } }] },
    data: { totp_last_step: step },
  });
  if (used.count !== 1) fail(userId, now); // the same code raced in twice
}

/** Step-up: a missing code reads as totp_invalid so the client asks for one. */
export async function requireStepUp(userId: string, code: string | null | undefined, db: PrismaClient, now: Date): Promise<void> {
  if (!code) throw new DealError("totp_invalid", "Enter the current code from your authenticator app.");
  await checkTotp(userId, code, db, now);
}

/** Sign-in with a recovery code: removes it; returns how many remain. */
export async function useRecoveryCode(userId: string, code: string, db: PrismaClient, now: Date): Promise<number> {
  limitFailures(userId, now);
  const hash = hashRecovery(code);
  const rows = normaliseRecovery(code).length === 10
    ? await db.$queryRaw<{ left: number }[]>`
        UPDATE "users" SET "recovery_codes" = array_remove("recovery_codes", ${hash})
        WHERE "id" = ${userId}::uuid AND "totp_enabled_at" IS NOT NULL AND ${hash} = ANY("recovery_codes")
        RETURNING cardinality("recovery_codes") AS "left"`
    : [];
  if (rows.length !== 1) fail(userId, now);
  return Number(rows[0]!.left);
}

/** New set of recovery codes; the old ones stop working. Caller has done step-up. */
export async function regenerateRecoveryCodes(userId: string, db: PrismaClient): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: userId }, data: { recovery_codes: codes.map(hashRecovery) } });
  return codes;
}

function limitFailures(userId: string, now: Date): void {
  if (!peek(`totp:${userId}`, FAIL_LIMIT, FAIL_WINDOW_MS, now.getTime())) {
    throw new DealError("rate_limited", "Too many wrong codes. Wait 10 minutes and try again.");
  }
}
function fail(userId: string, now: Date): never {
  allow(`totp:${userId}`, FAIL_LIMIT, FAIL_WINDOW_MS, now.getTime());
  throw new DealError("totp_invalid");
}
