// /new: a signed-out visitor goes to /?next=/new (08 section 6). The four steps are client state in NewDealFlow.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { NewDealFlow } from "@/components/NewDealFlow";

export default async function NewPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(token && (await readSession(token)))) redirect("/?next=/new");
  // T-33: pass `presets` read from public/demo/presets.json (08 section 12.2) when DEMO_LOGIN is on.
  return <NewDealFlow />;
}
