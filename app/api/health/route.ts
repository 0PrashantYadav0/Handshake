// GET /api/health -> { ok: true }. No database, no AI, no auth (04 section 13).
export function GET() {
  return Response.json({ ok: true });
}
