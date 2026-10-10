// POST /api/auth/sign-out -> clears hs_session (04 section 4.4).
import { clearSessionCookie } from "@/lib/auth/session";

export function POST() {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
}
