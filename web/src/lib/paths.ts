import fs from "node:fs";
import path from "node:path";

export function projectRoot(): string {
  const fromEnv = process.env.STEMSPLIT_ROOT;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "..");
}

export function stemsRoot(): string {
  const fromEnv = process.env.STEMSPLIT_OUTPUT;
  if (fromEnv) return path.resolve(fromEnv);
  const besideApp = path.resolve(process.cwd(), "stems");
  if (fs.existsSync(besideApp)) return besideApp;
  return path.resolve(process.cwd(), "..", "stems");
}

export function songsRoot(): string {
  const fromEnv = process.env.STEMSPLIT_SONGS;
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(projectRoot(), "songs");
}

/** Local stem root for one user (S3 prefix later). */
export function userStemsRoot(userId: string): string {
  return path.join(stemsRoot(), userId);
}

/** Local download root for one user. */
export function userSongsRoot(userId: string): string {
  return path.join(songsRoot(), userId);
}

export function storagePrefixFor(userId: string, slug: string): string {
  return path.posix.join(userId, ...slug.split("/").filter(Boolean));
}
