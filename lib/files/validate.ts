// Upload checks (02 section 9.3; 04 section 8.1; H3): magic bytes, size 1..2 MB, sha256. Pure.
import { createHash } from "node:crypto";
import { DealError } from "@/lib/deal/errors";
import type { Mime } from "@/lib/deal/types";

export const MAX_FILE_BYTES = 2_097_152;

const at = (b: Uint8Array, i: number, s: string) => b.length >= i + s.length && s.split("").every((ch, k) => b[i + k] === ch.charCodeAt(0));

/** The mime by the first bytes, or null when it is not JPEG, PNG or WebP. */
export function sniffMime(bytes: Uint8Array): Mime | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && at(bytes, 1, "PNG")) return "image/png";
  if (at(bytes, 0, "RIFF") && at(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

export function validateFile(bytes: Uint8Array): { mime: Mime; size_bytes: number; sha256: string } {
  if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) throw new DealError("file_too_large", "Files must be 1 byte to 2 MB.");
  const mime = sniffMime(bytes);
  if (!mime) throw new DealError("invalid_input", "Only JPEG, PNG and WebP images are accepted.");
  return { mime, size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
