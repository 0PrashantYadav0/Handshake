// The seller's payout address (trust spec §8). Changing it needs step-up; it is usable only after a 6-digit code sent to it
// comes back. The code is hashed with the user id and the address, single use, 15 minutes, five attempts.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { DealError } from "@/lib/deal/errors";
import type { Deps } from "@/lib/deal/types";
import { allow } from "@/lib/rate-limit";
import { requireStepUp } from "./mfa";

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const hashCode = (userId: string, email: string, code: string) => createHash("sha256").update(`${userId}\n${email}\n${code}`).digest("hex");

type D = Pick<Deps, "db" | "email" | "clock">;

/** Sets a new payout address (unverified) and emails its code. The same verified address again is a no-op. */
export async function setPayoutEmail(userId: string, email: string, totp: string | null | undefined, deps: D): Promise<void> {
  const to = email.trim().toLowerCase();
  const u = await deps.db.user.findUnique({ where: { id: userId }, select: { paypal_email: true, paypal_email_verified_at: true } });
  if (!u) throw new DealError("not_signed_in");
  if (u.paypal_email === to && u.paypal_email_verified_at) return;
  await requireStepUp(userId, totp, deps.db, deps.clock.now());
  await deps.db.user.update({ where: { id: userId }, data: { paypal_email: to, paypal_email_verified_at: null } });
  await issueCode(userId, to, deps);
}

/** A fresh code for the current unverified address; 3 per 10 minutes. */
export async function resendPayoutCode(userId: string, deps: D): Promise<void> {
  const u = await deps.db.user.findUnique({ where: { id: userId }, select: { paypal_email: true, paypal_email_verified_at: true } });
  if (!u?.paypal_email) throw new DealError("paypal_email_required", "Add a PayPal email first.");
  if (u.paypal_email_verified_at) throw new DealError("invalid_state", "This PayPal email is already verified.");
  if (!allow(`payout-code:${userId}`, 3, 10 * 60_000, deps.clock.now().getTime())) throw new DealError("rate_limited", "Wait a few minutes before asking for another code.");
  await issueCode(userId, u.paypal_email, deps);
}

async function issueCode(userId: string, email: string, deps: D): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await deps.db.user.update({
    where: { id: userId },
    data: { paypal_email_code_hash: hashCode(userId, email, code), paypal_email_code_expires_at: new Date(deps.clock.now().getTime() + CODE_TTL_MS), paypal_email_code_attempts: 0 },
  });
  await deps.email.send({
    to: email,
    subject: "Confirm your Handshake payout email",
    text: `Your Handshake confirmation code is ${code}.\n\nEnter it on Handshake to receive payouts at this PayPal address. It expires in 15 minutes.\nIf you did not ask for this, ignore this email; nothing will be sent here.`,
  });
}

/** Marks the address verified. Wrong, expired or exhausted codes fail; the code is cleared on success. */
export async function verifyPayoutEmail(userId: string, code: string, deps: D): Promise<void> {
  const now = deps.clock.now();
  const u = await deps.db.user.findUnique({ where: { id: userId } });
  if (!u) throw new DealError("not_signed_in");
  if (!u.paypal_email || !u.paypal_email_code_hash || !u.paypal_email_code_expires_at) throw new DealError("invalid_state", "Ask for a new code.");
  if (u.paypal_email_verified_at) return;
  const bad = (msg: string) => new DealError("invalid_input", msg);
  if (u.paypal_email_code_attempts >= MAX_ATTEMPTS) throw bad("Too many wrong codes. Ask for a new code.");
  if (now >= u.paypal_email_code_expires_at) throw bad("That code has expired. Ask for a new code.");
  const ok = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(hashCode(userId, u.paypal_email, code)), Buffer.from(u.paypal_email_code_hash));
  if (!ok) {
    await deps.db.user.update({ where: { id: userId }, data: { paypal_email_code_attempts: { increment: 1 } } });
    throw bad("That code is wrong. Check the email we sent to your PayPal address.");
  }
  // Conditional on the same hash, so a concurrent change of address cannot be verified with the old code.
  const done = await deps.db.user.updateMany({
    where: { id: userId, paypal_email: u.paypal_email, paypal_email_code_hash: u.paypal_email_code_hash },
    data: { paypal_email_verified_at: now, paypal_email_code_hash: null, paypal_email_code_expires_at: null, paypal_email_code_attempts: 0 },
  });
  if (done.count !== 1) throw new DealError("invalid_state", "The PayPal email changed; ask for a new code.");
}

/** Accepting as seller, agreeing terms and paying out all need this (payout_email_required / payout_email_unverified). */
export function requireVerifiedPayout(seller: { paypal_email: string | null; paypal_email_verified_at: Date | null } | null | undefined, who = "The seller"): string {
  if (!seller?.paypal_email) throw new DealError("paypal_email_required", `${who} must add a PayPal email before the terms can be agreed.`);
  if (!seller.paypal_email_verified_at) throw new DealError("payout_email_unverified", `${who} must verify the PayPal email first.`);
  return seller.paypal_email;
}
