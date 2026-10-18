import { Readable } from "node:stream";
import fs from "node:fs";

import { requireUserId } from "@/auth";
import { resolveAudioFile } from "@/lib/stems";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function streamResponse(file: string, request: Request): Response {
  const size = fs.statSync(file).size;
  const common = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0",
  };
  const header = request.headers.get("range");
  if (!header) {
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: { ...common, "Content-Length": String(size) },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  const start = match[1] === "" ? 0 : Number(match[1]);
  let end = match[2] === "" ? size - 1 : Number(match[2]);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  end = Math.min(end, size - 1);
  return new Response(
    Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream,
    {
      status: 206,
      headers: {
        ...common,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string[] }> },
) {
  const userId = await requireUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { slug } = await context.params;
  const file = await resolveAudioFile(userId, slug);
  if (!file) return new Response("Not found", { status: 404 });
  return streamResponse(file, request);
}
