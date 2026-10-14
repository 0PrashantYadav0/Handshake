// 02 section 9.5: validate every env var (lib/env.ts) once at server start. Nothing else imports lib/env, so without this a
// production server would boot with RESEND_API_KEY empty (sign-in links only in the log) or DEMO_LOGIN on live PayPal.
// A refused server answers 500 everywhere, /api/health included, so Render fails the deploy and keeps the previous one.
// Development only warns, so the app still runs before the PayPal and Anthropic keys exist.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    await import("@/lib/env");
  } catch (e) {
    if (process.env.NODE_ENV === "production") throw e;
    console.warn("[env] invalid environment (refused in production):", e instanceof Error ? e.message : e);
  }
}
