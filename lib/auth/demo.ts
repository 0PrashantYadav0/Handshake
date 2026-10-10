// Demo personas (F3; 04 section 4.3): upserted on every sign-in so a judge's PATCH /api/me cannot redirect payouts.
import type { PrismaClient } from "@/generated/prisma/client";
import { DealError } from "@/lib/deal/errors";

export type Persona = "buyer" | "seller";

const PERSONAS: Record<Persona, { email: string; display_name: string }> = {
  buyer: { email: "demo-buyer@handshake.demo", display_name: "Demo Buyer" },
  seller: { email: "demo-seller@handshake.demo", display_name: "Demo Seller" },
};

/** Returns the persona's user id. Throws invalid_input unless DEMO_LOGIN=true. */
export async function signInDemoPersona(persona: Persona, db: PrismaClient): Promise<string> {
  if (process.env.DEMO_LOGIN !== "true") throw new DealError("invalid_input", "Demo login is disabled.");
  const { email, display_name } = PERSONAS[persona];
  const data = persona === "seller" ? { display_name, paypal_email: process.env.DEMO_SELLER_PAYPAL_EMAIL || null } : { display_name };
  const user = await db.user.upsert({ where: { email }, create: { email, ...data }, update: data, select: { id: true } });
  return user.id;
}
