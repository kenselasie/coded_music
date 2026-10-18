import { requireUserId } from "@/auth";
import { addLocalFileToLibrary } from "@/lib/localAudio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose an audio file." }, { status: 400 });
  }

  const title =
    typeof form.get("title") === "string" ? (form.get("title") as string) : undefined;
  const artist =
    typeof form.get("artist") === "string" ? (form.get("artist") as string) : undefined;

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await addLocalFileToLibrary(userId, {
    filename: file.name,
    bytes,
    title,
    artist,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ entry: result.entry }, { status: 201 });
}
