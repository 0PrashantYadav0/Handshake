// Route-handler helpers: session, body parsing, error mapping (02 section 4; 04 section 1).
import { z } from "zod";
import { DealError, HTTP_STATUS } from "@/lib/deal/errors";
import { readSession, sessionFromCookieHeader } from "@/lib/auth/session";

export type Actor = { user_id: string };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function requireSession(req: Request): Promise<Actor> {
  const token = sessionFromCookieHeader(req.headers.get("cookie"));
  const user_id = token ? await readSession(token) : null;
  if (!user_id) throw new DealError("not_signed_in");
  return { user_id };
}

/** JSON body -> trimmed strings -> Zod. Throws invalid_input on a bad body. Unknown fields are ignored. */
export async function parseBody<T>(schema: z.ZodType<T>, req: Request): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new DealError("invalid_input", "Body must be JSON.");
  }
  const result = schema.safeParse(trimStrings(raw));
  if (!result.success) throw new DealError("invalid_input", result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return result.data;
}

function trimStrings(v: unknown): unknown {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(trimStrings);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimStrings(x)]));
  return v;
}

export function toResponse(e: unknown): Response {
  if (e instanceof DealError) {
    return json({ error: { code: e.code, message: e.message } }, HTTP_STATUS[e.code]);
  }
  console.error("[internal_error]", e);
  return json({ error: { code: "internal_error", message: "Something went wrong. Try again." } }, 500);
}

/** Wraps a handler so every throw becomes the H2 error shape. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      return toResponse(e);
    }
  };
}
