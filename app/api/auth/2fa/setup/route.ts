// POST /api/auth/2fa/setup -> a new pending TOTP secret, its otpauth URI and a QR code SVG (trust spec §4). Partial sessions allowed.
import { renderSVG } from "uqr";
import { startSetup } from "@/lib/auth/mfa";
import { getDeps } from "@/lib/deps";
import { json, requireAnySession, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const { user_id } = await requireAnySession(req);
  const { secret, otpauth_uri } = await startSetup(user_id, getDeps().db);
  return json({ secret, otpauth_uri, qr_svg: renderSVG(otpauth_uri, { border: 2 }) }, 200);
});
