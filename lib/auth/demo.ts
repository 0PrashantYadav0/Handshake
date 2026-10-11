// Demo personas (F3; 04 section 4.3): upserted on every sign-in so a judge's PATCH /api/me cannot redirect payouts.
// Trust spec §4: they are enrolled in 2FA with fixed, published secrets, and only while DEMO_LOGIN=true can their code be shown.
import type { PrismaClient } from "@/generated/prisma/client";
import { aad, open, seal } from "@/lib/crypto/seal";
import { DealError } from "@/lib/deal/errors";
import { hotp, base32Decode, stepAt, STEP_SEC } from "./totp";

export type Persona = "buyer" | "seller";

/** Public on purpose: these accounts exist only in demo mode. */
export const DEMO_TOTP_SECRETS: Record<Persona, string> = {
  buyer: "HANDSHAKEDEMOBUYERSECRETKEYAAAAA",
  seller: "HANDSHAKEDEMOSELLERSECRETKEYAAAA",
};

const PERSONAS: Record<Persona, { email: string; display_name: string }> = {
  buyer: { email: "demo-buyer@handshake.demo", display_name: "Demo Buyer" },
  seller: { email: "demo-seller@handshake.demo", display_name: "Demo Seller" },
};

const demoOn = () => process.env.DEMO_LOGIN === "true";
export const personaOf = (email: string): Persona | null =>
  (Object.keys(PERSONAS) as Persona[]).find((p) => PERSONAS[p].email === email) ?? null;

/** Returns the persona's user id. Throws invalid_input unless DEMO_LOGIN=true. */
export async function signInDemoPersona(persona: Persona, db: PrismaClient, now = new Date()): Promise<string> {
  if (!demoOn()) throw new DealError("invalid_input", "Demo login is disabled.");
  const { email, display_name } = PERSONAS[persona];
  const pp = process.env.DEMO_SELLER_PAYPAL_EMAIL || null; // the sandbox seller account: verified by configuration (trust spec §8)
  const data = persona === "seller" ? { display_name, paypal_email: pp, paypal_email_verified_at: pp ? now : null, paypal_email_code_hash: null } : { display_name };
  const user = await db.user.upsert({ where: { email }, create: { email, ...data }, update: data, select: { id: true, totp_enabled_at: true } });
  if (!user.totp_enabled_at) {
    await db.user.update({
      where: { id: user.id },
      data: { totp_secret: seal(DEMO_TOTP_SECRETS[persona], aad("users.totp_secret", user.id)), totp_enabled_at: now, totp_last_step: null },
    });
  }
  return user.id;
}

/** The persona's next usable code, so the demo shows a real second-factor step. 409 if the user is not a persona. */
export async function demoCode(userId: string, db: PrismaClient, now: Date): Promise<{ code: string; valid_for_sec: number }> {
  if (!demoOn()) throw new DealError("invalid_input", "Demo login is disabled.");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, totp_secret: true, totp_last_step: true } });
  if (!u || !personaOf(u.email) || !u.totp_secret) throw new DealError("invalid_state", "Demo codes exist only for the demo accounts.");
  const key = base32Decode(open(u.totp_secret, aad("users.totp_secret", userId)));
  const cur = stepAt(now.getTime());
  const step = u.totp_last_step === null || u.totp_last_step < cur ? cur : u.totp_last_step + 1;
  if (step > cur + 1) throw new DealError("invalid_state", "Wait a few seconds for the next code.");
  return { code: hotp(key, step), valid_for_sec: (step + 1) * STEP_SEC - Math.floor(now.getTime() / 1000) };
}
