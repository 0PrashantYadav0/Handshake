// The signed contract (trust spec §6). Pure and browser-safe: the server builds the document from the database, the
// browser re-hashes the document it shows, and both sign or verify the same bytes. Never change a field's meaning; add a
// new format version instead, since stored signatures cover the old one.
export const CONTRACT_FORMAT = 1;

export type ContractDoc = {
  v: typeof CONTRACT_FORMAT;
  code: string;
  terms_version: number;
  item_title: string;
  amount_minor: number;
  currency: "USD";
  deadline_days: number;
  conditions: { position: number; text: string; evidence_type: "photo" | "tracking" }[];
  buyer: { id: string; email: string };
  seller: { id: string; email: string };
};

/** JSON with object keys sorted at every level and no whitespace. Arrays keep their order. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("canonicalJson: non-finite number");
    if (v === undefined) throw new Error("canonicalJson: undefined");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** What each party's key signs. */
export const signingMessage = (hash: string) => `Handshake contract v${CONTRACT_FORMAT}\n${hash}`;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** SHA-256 hex of the canonical JSON, with WebCrypto (browser and Node 24). */
export async function contractHash(doc: ContractDoc): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(doc))));
}

/** The 16-hex-digit prefix people compare, grouped: "a1b2 c3d4 e5f6 0718". */
export const shortHash = (h: string) => h.slice(0, 16).replace(/(.{4})(?!$)/g, "$1 ");
