// /dashboard: session check on the server, then the Studio client shell (09 section 5.1). Signed out -> /.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { StudioDashboard } from "@/components/StudioDashboard";

export default async function DashboardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user_id = token ? await readSession(token) : null;
  if (!user_id) redirect("/?next=/dashboard");
  // The key is validated in the browser (09 section 7); empty locally, watermark only.
  return <StudioDashboard licenseKey={process.env.AG_GRID_LICENSE_KEY} dataUrl="/api/dashboard/data" />;
}
