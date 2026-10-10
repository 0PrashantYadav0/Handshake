// POST /api/deals/{code}/files multipart { purpose, file } -> addFile, 201 FileRef (04 section 8.1).
// Content-Length over 2.5 MB is refused before the body is read; the file itself is sniffed and capped at 2 MB.
import { addFile, DealError } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { MAX_BODY_BYTES, validateFile } from "@/lib/files/validate";
import { json, requireSession, route } from "@/lib/http";
import { Purpose } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) throw new DealError("file_too_large", "The request body exceeds 2.5 MB.");
  const form = await req.formData().catch(() => {
    throw new DealError("invalid_input", "Body must be multipart/form-data.");
  });
  const purpose = Purpose.safeParse(String(form.get("purpose") ?? "").trim());
  const file = form.get("file");
  if (!purpose.success || !(file instanceof Blob)) throw new DealError("invalid_input", "Send purpose (reference or evidence) and one file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime } = validateFile(bytes);
  return json(await addFile((await params).code, actor, { purpose: purpose.data, mime, bytes }, getDeps()), 201);
});
