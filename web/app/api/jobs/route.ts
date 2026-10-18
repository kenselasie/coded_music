import { requireUserId } from "@/auth";
import { findActiveJob, startStemJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const active = await findActiveJob(userId);
  return Response.json({ job: active });
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const url =
    typeof body === "object" &&
    body !== null &&
    "url" in body &&
    typeof (body as { url: unknown }).url === "string"
      ? (body as { url: string }).url
      : undefined;
  const trackId =
    typeof body === "object" &&
    body !== null &&
    "trackId" in body &&
    typeof (body as { trackId: unknown }).trackId === "string"
      ? (body as { trackId: string }).trackId
      : undefined;

  const result = await startStemJob(userId, { url, trackId });
  if (!result.ok) {
    return Response.json(
      { error: result.error, job: result.job ?? null },
      { status: result.status },
    );
  }
  return Response.json({ job: result.job }, { status: 201 });
}
