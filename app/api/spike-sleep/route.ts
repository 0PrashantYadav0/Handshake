// TEMPORARY spike 4 (02 section 12, issue 22): does Render's proxy allow a 40 s response? Delete this route the same day the spike runs.
// No database, no AI, no auth.
export async function GET() {
  await new Promise((resolve) => setTimeout(resolve, 40_000));
  return Response.json({ ok: true, slept_ms: 40_000 });
}
