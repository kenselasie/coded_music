import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { registerLibraryTrack, type LibraryEntry } from "./library";
import { userSongsRoot } from "./paths";
import { slugify } from "./youtubeMeta";

export const LOCAL_AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".aiff",
  ".aif",
]);

export const MAX_LOCAL_UPLOAD_BYTES = 200 * 1024 * 1024;

export function titleFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[_-]+/g, " ").trim() || "Local track";
}

export async function addLocalFileToLibrary(
  userId: string,
  input: {
    filename: string;
    bytes: Buffer;
    title?: string;
    artist?: string;
  },
): Promise<
  | { ok: true; entry: LibraryEntry }
  | { ok: false; error: string; status: number }
> {
  const ext = path.extname(input.filename).toLowerCase();
  if (!LOCAL_AUDIO_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: "Use a common audio file (wav, mp3, flac, m4a, ogg, aiff).",
      status: 400,
    };
  }
  if (input.bytes.length === 0) {
    return { ok: false, error: "That file is empty.", status: 400 };
  }
  if (input.bytes.length > MAX_LOCAL_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "File is too large (max 200 MB).",
      status: 400,
    };
  }

  const title = (input.title?.trim() || titleFromFilename(input.filename)).slice(
    0,
    200,
  );
  const artist = (input.artist?.trim() || "Local file").slice(0, 200);
  const slug = ["local", slugify(artist), `${slugify(title)}-${randomUUID().slice(0, 8)}`].join(
    "/",
  );
  const destDir = path.join(userSongsRoot(userId), ...slug.split("/"));
  fs.mkdirSync(destDir, { recursive: true });
  const safeName = `${slugify(title) || "track"}${ext}`;
  const destPath = path.join(destDir, safeName);
  fs.writeFileSync(destPath, input.bytes);

  const entry = await registerLibraryTrack(userId, {
    slug,
    title,
    artist,
    url: null,
    source: "local",
    sourcePath: destPath,
    status: "queued",
  });

  return { ok: true, entry };
}
