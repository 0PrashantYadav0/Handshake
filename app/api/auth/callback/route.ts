// The sign-in link (K10). GET only forwards to /signin/link, which shows a "Continue" button: mail scanners that open
// links must not spend a single-use token. POST (that button, same origin only) verifies the token, upserts the user,
// sets a partial hs_session and 303s to the second factor (trust spec §4): /signin/2fa when 2FA is on, /security/setup
// when it is not. A bad or used token -> 303 /signin?error=invalid_link (04 section 4.2).
import { safeNext, verifyMagicToken } from "@/lib/auth/magic-link";
import { issueSession } from "@/lib/auth/session-version";
import { getDeps } from "@/lib/deps";
import { route } from "@/lib/http";

const redirect = (status: 302 | 303, location: string, cookie?: string) =>
  new Response(null, { status, headers: cookie ? { location, "set-cookie": cookie } : { location } });

export const GET = route(async (req: Request) => redirect(302, `/signin/link${new URL(req.url).search}`));

export const POST = route(async (req: Request) => {
  // Login CSRF: another site must not be able to sign the visitor into an account whose link it holds.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(process.env.APP_URL ?? req.url).origin) return redirect(303, "/signin?error=invalid_link");
  const form = await req.formData().catch(() => null);
  const { db } = getDeps();
  const email = await verifyMagicToken(String(form?.get("token") ?? ""), db);
  if (!email) return redirect(303, "/signin?error=invalid_link");
  const user = await db.user.upsert({ where: { email }, create: { email }, update: {}, select: { id: true, totp_enabled_at: true } });
  const next = encodeURIComponent(safeNext(String(form?.get("next") ?? "")));
  const to = user.totp_enabled_at ? `/signin/2fa?next=${next}` : `/security/setup?next=${next}`;
  return redirect(303, to, await issueSession(user.id, false, db));
});
