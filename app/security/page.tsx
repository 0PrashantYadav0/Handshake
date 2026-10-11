// /security: second-factor status, recovery codes (trust spec §4) and signing keys (§6).
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/current";
import { mfaStatus } from "@/lib/auth/mfa";
import { getDeps } from "@/lib/deps";
import { SecurityPanel } from "@/components/auth/SecurityPanel";
import { KeysPanel } from "@/components/auth/KeysPanel";
import { listKeys } from "@/lib/auth/keys";

export default async function SecurityPage() {
  const id = await currentUserId();
  if (!id) redirect("/signin?next=/security");
  const { db } = getDeps();
  const [status, keys] = await Promise.all([mfaStatus(id, db), listKeys(id, db)]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="hs-display mb-6 text-4xl">Security</h1>
      <div className="flex flex-col gap-4">
        <SecurityPanel status={status} />
        <KeysPanel keys={keys} />
      </div>
    </main>
  );
}
