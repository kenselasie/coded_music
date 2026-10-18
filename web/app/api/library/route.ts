import { requireUserId } from "@/auth";
import { addYoutubeToLibrary } from "@/lib/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      : "";

  const result = await addYoutubeToLibrary(userId, url);
  if (!result.ok) {
    return Response.json(
      { error: result.error, entry: result.entry ?? null },
      { status: result.status },
    );
  }
  return Response.json({ entry: result.entry }, { status: 201 });
}
