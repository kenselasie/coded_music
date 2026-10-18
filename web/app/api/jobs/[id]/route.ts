import { and, eq } from "drizzle-orm";

import { requireUserId } from "@/auth";
import { getDb } from "@/db";
import { userLocks } from "@/db/schema";
import { readJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: "Unknown job." }, { status: 404 });
  }
  const job = await readJob(userId, id);
  if (!job) {
    return Response.json({ error: "Unknown job." }, { status: 404 });
  }
  if (job.status === "done" || job.status === "failed") {
    const db = getDb();
    await db
      .delete(userLocks)
      .where(and(eq(userLocks.userId, userId), eq(userLocks.jobId, id)));
  }
  return Response.json({ job });
}
