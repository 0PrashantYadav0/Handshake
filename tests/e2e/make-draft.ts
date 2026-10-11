// Creates a live draft deal for the demo buyer straight through lib/deal, with the fake model, so the two-party spec runs
// without an Anthropic key. Prints the deal code. Uses E2E_DATABASE_URL, else DATABASE_URL (the server's database).
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json tests/e2e/make-draft.ts
try { process.loadEnvFile(); } catch {}
if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
process.env.DEMO_LOGIN = "true";

// Imports after the env is set: lib/db reads DATABASE_URL when it loads.
void (async () => {
  const { signInDemoPersona } = await import("@/lib/auth/demo");
  const { prisma } = await import("@/lib/db");
  const { getDeps, overrideDeps } = await import("@/lib/deps");
  const { fakeAi } = await import("@/lib/ai/fake");
  const { createDeal } = await import("@/lib/deal");

  const buyer = await signInDemoPersona("buyer", prisma);
  await signInDemoPersona("seller", prisma);
  overrideDeps({ ai: fakeAi() });
  const d = await createDeal({ user_id: buyer }, { text: "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos" }, getDeps());
  console.log(d.code);
  await prisma.$disconnect();
})();
