// /security: second-factor status and recovery codes (trust spec §4). Signing keys join this page in TR-5.
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/current";
import { mfaStatus } from "@/lib/auth/mfa";
import { getDeps } from "@/lib/deps";
import { SecurityPanel } from "@/components/auth/SecurityPanel";

export default async function SecurityPage() {
  const id = await currentUserId();
  if (!id) redirect("/signin?next=/security");
  const status = await mfaStatus(id, getDeps().db);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="hs-display mb-6 text-4xl">Security</h1>
      <SecurityPanel status={status} />
    </main>
  );
}
