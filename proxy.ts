// H-2: a fresh CSP nonce per page request (Next 16 guide "Content Security Policy"). Next reads the policy from the request
// headers and puts the nonce on its own scripts; every page is dynamic already (the root layout reads the session cookie).
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";

export function proxy(request: NextRequest) {
  const csp = buildCsp(newNonce(), { dev: process.env.NODE_ENV === "development", https: process.env.APP_URL?.startsWith("https:") ?? false });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

// Pages only: API routes answer JSON or image bytes, static files carry no script, and _next/ includes the dev HMR socket.
export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/|favicon.ico|demo/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
