// POST /api/auth/magic-link { email, next? } -> emails the login link; always 200 so addresses cannot be probed (04 section 4.1).
import { z } from "zod";
import { buildMagicLink, createMagicToken } from "@/lib/auth/magic-link";
import { getDeps } from "@/lib/deps";
import { json, parseBody, route } from "@/lib/http";

// html5Email: what <input type="email"> accepts (dot-less hosts included), matching the test addresses in 06.
const Body = z.object({ email: z.email({ pattern: z.regexes.html5Email }), next: z.string().optional() });

export const POST = route(async (req: Request) => {
  const { email, next } = await parseBody(Body, req);
  const to = email.toLowerCase();
  const link = buildMagicLink(await createMagicToken(to), next);
  await getDeps().email.send({ to, subject: "Your Handshake sign-in link", text: `Sign in to Handshake (link valid for 15 minutes):\n\n${link}` });
  return json({ ok: true });
});
