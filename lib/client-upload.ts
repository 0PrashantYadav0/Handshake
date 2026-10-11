// Browser-side photo pipeline (B6; 08 sections 4.4, 6.3, 7.7; stack.md section 9): downscale, the upload call, error copy.
// Pure helpers up top are unit-tested; `downscale` and `api` need a browser.
import type { FileRef } from "@/lib/deal/types";

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;
export const MAX_BYTES = 2_097_152;
export const UNDECODABLE_COPY = "Please choose a JPEG or PNG photo.";
export const OVERSIZE_COPY = "That photo is over 2 MB after resizing. Try a smaller one.";
const SERVER_MIMES = ["image/jpeg", "image/png", "image/webp"];

/** Canvas size for a long edge of `max`; never scales up. */
export function targetSize(w: number, h: number, max = MAX_EDGE): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** False when the file already fits (<= max long edge, <= 2 MB, a type the server accepts): it is sent as-is. */
export function needsDownscale(w: number, h: number, size: number, type: string, max = MAX_EDGE): boolean {
  return Math.max(w, h) > max || size > MAX_BYTES || !SERVER_MIMES.includes(type);
}

export const formatBytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Decodes with EXIF rotation applied and re-encodes as JPEG. Throws Error(UNDECODABLE_COPY) on HEIC and the like, Error(OVERSIZE_COPY) over 2 MB. */
export async function downscale(file: File, max = MAX_EDGE, quality = JPEG_QUALITY): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error(UNDECODABLE_COPY);
  });
  try {
    if (!needsDownscale(bmp.width, bmp.height, file.size, file.type, max)) return file;
    const { width, height } = targetSize(bmp.width, bmp.height, max);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", quality));
    if (!blob) throw new Error(UNDECODABLE_COPY);
    if (blob.size > MAX_BYTES) throw new Error(OVERSIZE_COPY);
    return blob;
  } finally {
    bmp.close();
  }
}

// ---------- API calls and the 08 section 4.4 copy ----------

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const GENERIC = "Something went wrong on our side. Try again.";
const COPY: Record<string, string> = {
  file_too_large: "That photo is over 2 MB. Choose a smaller one.",
  invalid_state: "This deal has moved on. Showing the latest state.",
  terms_version_mismatch: "The terms changed while you were looking. Showing the latest version.",
  condition_not_checkable:
    "We couldn't find anything checkable in that sentence. Say what a photo or a tracking number should show, for example 'matches the listing photos' or 'tracking shows delivered'.",
  unsupported_currency: "Only US dollars are supported. Write the price as $ or USD.",
  too_many_files: "Up to 4 listing photos.", // ponytail: the evidence form (T-28) reads "Up to 6 photos."; parametrise then
  ai_unavailable: "The model didn't answer. Try again.",
  internal_error: GENERIC,
};

/** The screen copy for a thrown API or network error. `invalid_input` shows the server's sentence. */
export function errorCopy(e: unknown): string {
  if (!(e instanceof ApiError)) return GENERIC;
  if (e.code === "invalid_input") return e.message || "Check the highlighted fields.";
  return COPY[e.code] ?? GENERIC;
}

/** fetch that resolves the JSON body or throws ApiError on the H2 error shape. A 401 goes to the sign-in panel. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.ok) return res.json() as Promise<T>;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  const code = body?.error?.code ?? "internal_error";
  if (code === "not_signed_in") location.assign(new URL(`/signin?next=${encodeURIComponent(location.pathname)}`, location.origin).href);
  throw new ApiError(code, body?.error?.message ?? "");
}

export const sendJson = <T,>(path: string, method: "POST" | "PATCH", body: unknown) =>
  api<T>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** POST /api/deals/{code}/files (04 section 8.1) -> FileRef with its signed url. */
export function uploadFile(code: string, purpose: "reference" | "evidence", blob: Blob): Promise<FileRef> {
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", blob, "photo.jpg");
  return api<FileRef>(`/api/deals/${code}/files`, { method: "POST", body: form });
}
