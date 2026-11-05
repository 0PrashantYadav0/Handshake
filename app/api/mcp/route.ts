// POST /api/mcp: the Handshake MCP server (docs/agents.md). Authorization: Bearer <agent key>. JSON responses, no session.
import { agentFromToken } from "@/lib/agents/keys";
import { handleRpc } from "@/lib/agents/mcp";
import { getDeps } from "@/lib/deps";
import { json, toResponse } from "@/lib/http";
import { allow } from "@/lib/rate-limit";

const MAX_BODY = 12 * 1024 * 1024; // up to four 2 MB photos as base64
const baseUrl = (req: Request) => process.env.APP_URL ?? new URL(req.url).origin;

export async function POST(req: Request) {
  try {
    const token = /^Bearer (hsk_[\w-]+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const deps = getDeps();
    const key = token ? await agentFromToken(token, deps.db, deps.clock.now()) : null;
    if (!key) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "A valid agent key is required. Make one at /agents." } }, 401);
    if (!allow(`mcp:${key.id}`, 120, 10 * 60_000)) return json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Too many requests; try again in a few minutes." } }, 429);
    if (Number(req.headers.get("content-length")) > MAX_BODY) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, 413);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    const context = { key, deps, baseUrl: baseUrl(req) };
    if (Array.isArray(body)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported." } }, 400);
    const out = await handleRpc(body, context);
    return out ? json(out) : new Response(null, { status: 202 });
  } catch (e) {
    return toResponse(e);
  }
}

export const GET = () => new Response(null, { status: 405, headers: { allow: "POST" } }); // no server-initiated stream
