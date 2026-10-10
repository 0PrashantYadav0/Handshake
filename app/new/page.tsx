// /new: a signed-out visitor goes to /?next=/new (08 section 6). The four steps are client state in NewDealFlow.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import type { Presets } from "@/lib/demo-kit";
import { NewDealFlow } from "@/components/NewDealFlow";

export default async function NewPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(token && (await readSession(token)))) redirect("/?next=/new");
  // T-33: the demo kit (08 section 12.2) is read on the server so the chips are in the first paint; only when DEMO_LOGIN is on.
  const kit = process.env.DEMO_LOGIN === "true" ? (JSON.parse(await readFile(join(process.cwd(), "public/demo/presets.json"), "utf8")) as Presets) : null;
  return <NewDealFlow kit={kit} />;
}
