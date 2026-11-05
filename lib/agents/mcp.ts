// A stateless MCP server over Streamable HTTP with JSON responses: initialize, ping, tools/list, tools/call (docs/agents.md).
import { z } from "zod";
import { DealError } from "@/lib/deal/errors";
import { callTool, TOOLS, type ToolContext } from "./tools";

const LATEST = "2025-06-18";
const INSTRUCTIONS = `Handshake is pay on proof. Propose a deal from one sentence, attach listing photos, have both sides sign. A person then approves the hold at PayPal, the seller submits proof, Claude judges it, and fixed code releases or voids the money. You cannot approve a hold or a buyer review: call get_deal and follow next_step.`;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One JSON-RPC message -> its response, or null for a notification. */
export async function handleRpc(m: Rpc, c: ToolContext) {
  if (m.id === undefined) return null;
  switch (m.method) {
    case "initialize":
      return ok(m.id, {
        protocolVersion: m.params?.protocolVersion ?? LATEST,
        capabilities: { tools: {} },
        serverInfo: { name: "handshake", title: "Handshake: pay on proof", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema) })) });
    case "tools/call":
      try {
        const out = await callTool(m.params?.name ?? "", m.params?.arguments, c);
        return ok(m.id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], isError: false });
      } catch (e) {
        if (!(e instanceof DealError)) throw e;
        return ok(m.id, { content: [{ type: "text", text: JSON.stringify({ error: e.code, message: e.message }) }], isError: true });
      }
    default:
      return err(m.id, -32601, `Method not found: ${m.method}`);
  }
}
