// POST /api/mcp: the Handshake MCP server (docs/agents.md). Authorization: Bearer <agent key>. JSON responses, no session.
import { agentFromToken } from "@/lib/agents/keys";
import { handleRpc } from "@/lib/agents/mcp";
import { getDeps } from "@/lib/deps";
import { json, readCapped, toResponse } from "@/lib/http";
import { allow } from "@/lib/rate-limit";

const MAX_BODY = 17 * 1024 * 1024; // six 2 MB photos as base64 (16.8 MB) plus the JSON around them
// Full-size calls at once, for the 512 MB plan: on a local next start with a 256 MB heap, two peaked at 415 MB RSS and four at 505 MB, before any tool work.
// A body that declares itself small takes no slot. ponytail: one counter for all keys, so two slow uploads make other large calls wait; per-user slots if that bites.
const MAX_LARGE_IN_FLIGHT = 2;
const SMALL_BODY = 1024 * 1024;
let largeInFlight = 0;
const baseUrl = (req: Request) => process.env.APP_URL ?? new URL(req.url).origin;

export async function POST(req: Request) {
  try {
    const token = /^Bearer (hsk_[\w-]+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const deps = getDeps();
    const key = token ? await agentFromToken(token, deps.db, deps.clock.now()) : null;
    if (!key) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "A valid agent key is required. Make one at /agents." } }, 401);
    if (!allow(`mcp:${key.user_id}`, 120, 10 * 60_000)) return json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Too many requests; try again in a few minutes." } }, 429);
    const declared = req.headers.get("content-length");
    const large = declared === null || Number(declared) > SMALL_BODY; // no Content-Length: chunked, so it could be any size
    if (large && largeInFlight >= MAX_LARGE_IN_FLIGHT) return json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "The server is busy; try again in a moment." } }, 503);
    if (large) largeInFlight++;
    try {
      const capped = await readCapped(req, MAX_BODY);
      if (!capped) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, 413);
      const body = await capped.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
      const context = { key, deps, baseUrl: baseUrl(req) };
      if (Array.isArray(body)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported." } }, 400);
      const out = await handleRpc(body, context);
      return out ? json(out) : new Response(null, { status: 202 });
    } finally {
      if (large) largeInFlight--;
    }
  } catch (e) {
    return toResponse(e);
  }
}

export const GET = () => new Response(null, { status: 405, headers: { allow: "POST" } }); // no server-initiated stream
