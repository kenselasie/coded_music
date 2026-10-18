import { requireUserId } from "@/auth";
import { listJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  return Response.json({ jobs: await listJobs(userId) });
}
