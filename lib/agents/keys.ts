// Agent keys (docs/agents.md): a bearer token for an AI agent, bound to a user and a per-deal spending ceiling, plus the P-256 key
// the agent signs contracts with. The token is stored as a hash and the private key sealed; a revoked key stops both at once.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { signingMessage } from "@/lib/contract/canonical";
import { bytesToB64url, type PublicKey } from "@/lib/contract/signature";
import { aad, open, seal } from "@/lib/crypto/seal";
import { DealError } from "@/lib/deal/errors";

export const MAX_MANDATE_MINOR = 100_000; // $1,000; the rule still sends anything over $200 to a person
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const CURVE = { name: "ECDSA", namedCurve: "P-256" } as const;

export type AgentKeyRow = { id: string; user_id: string; label: string; max_amount_minor: number; signing_jwk: string };
export type AgentKeySummary = { id: string; label: string; token_hint: string; max_amount_minor: number; created_at: Date; last_used_at: Date | null; revoked_at: Date | null };

export async function issueAgentKey(userId: string, input: { label: string; max_amount_minor: number }, db: PrismaClient): Promise<{ token: string; key: AgentKeyRow }> {
  const label = input.label.trim();
  if (label.length < 1 || label.length > 60) throw new DealError("invalid_input", "Name the agent in 1 to 60 characters.");
  if (!Number.isInteger(input.max_amount_minor) || input.max_amount_minor < 100 || input.max_amount_minor > MAX_MANDATE_MINOR) throw new DealError("invalid_input", "The ceiling must be between $1 and $1,000.");
  const { privateKey } = await crypto.subtle.generateKey(CURVE, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const id = randomUUID();
  const token = `hsk_${randomBytes(24).toString("base64url")}`;
  const key = await db.agentKey.create({
    data: { id, user_id: userId, label, max_amount_minor: input.max_amount_minor, token_hash: hash(token), token_hint: token.slice(0, 8), signing_jwk: seal(JSON.stringify(jwk), aad("agent_keys.signing_jwk", id)) },
  });
  return { token, key };
}

/** The live key for a bearer token, or null; records the use. */
export async function agentFromToken(token: string, db: PrismaClient, now: Date): Promise<AgentKeyRow | null> {
  const key = await db.agentKey.findUnique({ where: { token_hash: hash(token) } });
  if (!key || key.revoked_at) return null;
  await db.agentKey.update({ where: { id: key.id }, data: { last_used_at: now } });
  return key;
}

export const listAgentKeys = (userId: string, db: PrismaClient): Promise<AgentKeySummary[]> =>
  db.agentKey.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    select: { id: true, label: true, token_hint: true, max_amount_minor: true, created_at: true, last_used_at: true, revoked_at: true },
  });

export async function revokeAgentKey(userId: string, id: string, db: PrismaClient, now: Date): Promise<void> {
  const { count } = await db.agentKey.updateMany({ where: { id, user_id: userId, revoked_at: null }, data: { revoked_at: now } });
  if (count === 0) throw new DealError("invalid_input", "No such active agent key.");
}

/** Signs a contract hash as the agent. Same message and format as a browser's device key, so verifyContract treats both alike. */
export async function signAsAgent(key: AgentKeyRow, contractHash: string): Promise<{ signature: string; public_key: PublicKey }> {
  const jwk = JSON.parse(open(key.signing_jwk, aad("agent_keys.signing_jwk", key.id))) as JsonWebKey;
  const priv = await crypto.subtle.importKey("jwk", jwk, CURVE, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, new TextEncoder().encode(signingMessage(contractHash)));
  return { signature: bytesToB64url(sig), public_key: { x: jwk.x!, y: jwk.y! } };
}
