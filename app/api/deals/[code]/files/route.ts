// POST /api/deals/{code}/files multipart { purpose, file } -> addFile, 201 FileRef (04 section 8.1).
// A body over 2.5 MB is refused, by Content-Length before it is read or by counting a chunked one; the file itself is sniffed and capped at 2 MB.
import { addFile, DealError } from "@/lib/deal";
import { getDeps } from "@/lib/deps";
import { MAX_BODY_BYTES, validateFile } from "@/lib/files/validate";
import { json, readCapped, requireSession, route } from "@/lib/http";
import { Purpose } from "@/lib/http-schemas";

export const POST = route(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  const actor = await requireSession(req);
  const capped = await readCapped(req, MAX_BODY_BYTES);
  if (!capped) throw new DealError("file_too_large", "The request body exceeds 2.5 MB.");
  const form = await capped.formData().catch(() => {
    throw new DealError("invalid_input", "Body must be multipart/form-data.");
  });
  const purpose = Purpose.safeParse(String(form.get("purpose") ?? "").trim());
  const file = form.get("file");
  if (!purpose.success || !(file instanceof Blob)) throw new DealError("invalid_input", "Send purpose (reference or evidence) and one file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime } = validateFile(bytes);
  return json(await addFile((await params).code, actor, { purpose: purpose.data, mime, bytes }, getDeps()), 201);
});
