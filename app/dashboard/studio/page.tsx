// /dashboard/studio (trust spec §10; moved unchanged from /dashboard): session check on the server, then the Studio client shell (09 section 5.1). Signed out -> /signin.
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/current";
import { StudioDashboard } from "@/components/StudioDashboard";

export default async function DashboardPage() {
  const user_id = await currentUserId();
  if (!user_id) redirect("/signin?next=/dashboard/studio");
  // The key is validated in the browser (09 section 7); empty locally, watermark only.
  // T-38: the agent is offered only when the server holds an Anthropic key (09 section 6.7 otherwise).
  return <StudioDashboard licenseKey={process.env.AG_GRID_LICENSE_KEY} dataUrl="/api/dashboard/data" agent={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}
