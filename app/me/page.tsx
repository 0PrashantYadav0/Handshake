// /me: profile first paint from getMe on the server (08 sections 4.2, 10). Signed out -> /signin?next=/me.
import { safeNext } from "@/lib/auth/magic-link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current";
import { ProfileForm } from "@/components/ProfileForm";

export default async function MePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/me");
  const { next } = await searchParams;
  return (
    <main className="mx-auto max-w-xl p-4 md:p-8">
      <h1 className="mb-4 text-2xl font-semibold">Your profile</h1>
      {/* Only same-site paths come back from the paypal_email_required prompt (section 10). */}
      <ProfileForm me={me} next={next && safeNext(next) === next ? next : undefined} />
    </main>
  );
}
