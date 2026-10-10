// GET /api/files/{id}?exp=&sig= -> the stored bytes; the signature is the credential, no session (04 section 8.2).
// lib/db omits file.bytes globally, so this route selects them explicitly.
import { z } from "zod";
import { DealError } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { verifyFileUrl } from "@/lib/files/urls";
import { route } from "@/lib/http";
import { FileQuery } from "@/lib/http-schemas";

export const GET = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const query = FileQuery.safeParse({ exp: q.get("exp"), sig: q.get("sig") });
  if (!query.success) throw new DealError("invalid_input", "Missing or malformed exp or sig.");
  const { db, clock } = getDeps();
  if (!verifyFileUrl(id, query.data.exp, query.data.sig, clock.now())) throw new DealError("not_a_party", "This link has expired.");
  const file = z.uuid().safeParse(id).success ? await db.file.findUnique({ where: { id }, select: { mime: true, bytes: true } }) : null;
  if (!file) throw new DealError("deal_not_found", "File not found.");
  const bytes = new Uint8Array(file.bytes);
  return new Response(bytes, {
    headers: { "content-type": file.mime, "content-length": String(bytes.length), "cache-control": "private, max-age=600", "content-disposition": "inline" },
  });
});
