// Composition root (02 section 3.4; 06 "Fakes"). Built once from env; tests swap members with overrideDeps.
import { SystemClock } from "@/lib/clock";
import { prisma } from "@/lib/db";
import type { Deps } from "@/lib/deal/types";
import { realAi } from "@/lib/ai";
import { emailFromEnv } from "@/lib/email";
import { realPaypal } from "@/lib/paypal";

let current: Deps | undefined;

export function getDeps(): Deps {
  return (current ??= { db: prisma, paypal: realPaypal(), ai: realAi, email: emailFromEnv(), clock: SystemClock });
}

/** Tests only. Nothing under app/ or lib/ calls this (tests/unit/deps-boundary.test.ts). */
export function overrideDeps(partial: Partial<Deps>): void {
  current = { ...getDeps(), ...partial };
}
