// Integration harness (06 "Harness"): real Postgres, fakes for everything else.
import { prisma } from "@/lib/db";
import { fixedClock, type FixedClock } from "@/lib/clock";
import { overrideDeps } from "@/lib/deps";
import { fakeAi, type FakeAi } from "@/lib/ai/fake";
import { fakeEmail, type RecordingEmail } from "@/lib/email/console";
import { fakePaypal, type FakePaypal } from "@/lib/paypal/fake";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import type { PaypalWebhookEvent } from "@/lib/deal/types";

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";

export const CLOCK_START = "2026-10-20T10:00:00Z";

export type TestDeps = { db: typeof prisma; paypal: FakePaypal; ai: FakeAi; email: RecordingEmail; clock: FixedClock };

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "webhook_events", "deal_events", "payouts", "payments", "verdicts",
      "evidence", "files", "conditions", "deals", "users" RESTART IDENTITY CASCADE`,
  );
}

let deps: TestDeps | undefined;

/** Builds fresh fakes, installs them with overrideDeps, and returns them for assertions. */
export function testDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  const clock = overrides.clock ?? fixedClock(CLOCK_START);
  deps = { db: prisma, paypal: fakePaypal(clock), ai: fakeAi(), email: fakeEmail(), clock, ...overrides };
  overrideDeps(deps);
  return deps;
}

export function makeUser(email: string, opts: { display_name?: string; paypal_email?: string } = {}) {
  return prisma.user.create({ data: { email, display_name: opts.display_name ?? null, paypal_email: opts.paypal_email ?? null } });
}

export async function signIn(userId: string): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(userId)}`;
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

export function callRoute(
  handler: Handler,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<Response> | Response {
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = typeof opts.body === "string" || opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
    if (typeof body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return handler(new Request(`http://localhost${path}`, { method, headers, body }), { params: Promise.resolve(opts.params ?? {}) });
}

export function webhookEvent(type: string, resource: Record<string, unknown>): PaypalWebhookEvent {
  if (!deps) throw new Error("call testDeps() first");
  return deps.paypal.event(type, resource);
}
