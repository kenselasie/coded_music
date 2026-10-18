import fs from "node:fs";
import path from "node:path";

import {
  getLibraryEntryBySlug,
  isInLibrary,
  readLibraryEntries,
  type LibraryEntry,
} from "./library";
import { stemsRoot, userStemsRoot } from "./paths";
import {
  STEM_NAMES,
  type Library,
  type StemFile,
  type StemName,
  type TrackSummary,
} from "./types";

export { stemsRoot };

export function titleFromSlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function safeParts(parts: string[]): string[] | null {
  const decoded = parts.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return null;
    }
  });
  if (decoded.some((part) => part === null)) return null;
  const names = decoded as string[];
  if (
    names.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes("/") ||
        part.includes("\\") ||
        part.includes("\0"),
    )
  ) {
    return null;
  }
  return names;
}

export function resolveInside(root: string, parts: string[]): string | null {
  const names = safeParts(parts);
  if (!names) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, ...names);
  const relative = path.relative(base, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return full;
}

function stemRecord(
  dir: string,
  audioSlugParts: string[],
): { stems: StemFile[]; updatedAt: number } {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const files = new Map(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => [entry.name.toLowerCase(), entry.name]),
  );
  let updatedAt = 0;
  const stems = STEM_NAMES.map((name) => {
    const actual = files.get(`${name}.wav`);
    if (!actual) return { name, bytes: null, url: null };
    const full = path.join(dir, actual);
    const stat = fs.statSync(full);
    if (stat.size <= 0) return { name, bytes: null, url: null };
    updatedAt = Math.max(updatedAt, stat.mtimeMs);
    const encoded = [...audioSlugParts.map(encodeURIComponent), name].join("/");
    return { name, bytes: stat.size, url: `/api/audio/${encoded}` };
  });
  return { stems, updatedAt };
}

function summaryForEntry(userId: string, entry: LibraryEntry): TrackSummary | null {
  const parts = entry.slug.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const dir = resolveInside(userStemsRoot(userId), parts);
  if (!dir) return null;
  const record = stemRecord(dir, parts);
  const present = record.stems.filter((stem) => stem.bytes !== null).length;
  const status =
    present === STEM_NAMES.length
      ? "ready"
      : entry.status === "processing" || entry.status === "failed"
        ? entry.status
        : entry.status === "ready" && present < STEM_NAMES.length
          ? "queued"
          : (entry.status ?? (present > 0 ? "ready" : "queued"));
  return {
    id: entry.id,
    slug: entry.slug,
    title: entry.title || titleFromSlug(parts[parts.length - 1] ?? "Track"),
    group: entry.artist || parts.slice(0, -1).map(titleFromSlug).join(" / "),
    href: `/tracks/${parts.map(encodeURIComponent).join("/")}`,
    stems: record.stems,
    present,
    status,
    url: entry.url ?? null,
    source: entry.source,
    updatedAt:
      record.updatedAt > 0
        ? new Date(record.updatedAt).toISOString().replace("T", " ").slice(0, 16) +
          " UTC"
        : entry.addedAt
          ? entry.addedAt.replace("T", " ").slice(0, 16) + " UTC"
          : null,
  };
}

export async function readLibrary(userId: string): Promise<Library> {
  const root = userStemsRoot(userId);
  const entries = await readLibraryEntries(userId);
  const tracks = entries
    .map((entry) => summaryForEntry(userId, entry))
    .filter((track): track is TrackSummary => track !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    root,
    exists: fs.existsSync(root) && fs.statSync(root).isDirectory(),
    tracks,
  };
}

export async function readTrack(
  userId: string,
  slug: string[],
): Promise<TrackSummary | null> {
  const id = safeParts(slug)?.join("/");
  if (!id || !(await isInLibrary(userId, id))) return null;
  const entry = await getLibraryEntryBySlug(userId, id);
  if (!entry) return null;
  return summaryForEntry(userId, entry);
}

export async function resolveAudioFile(
  userId: string,
  slug: string[],
): Promise<string | null> {
  if (slug.length < 2) return null;
  const stem = slug[slug.length - 1]?.toLowerCase();
  if (!STEM_NAMES.includes(stem as StemName)) return null;
  const trackParts = slug.slice(0, -1);

  const id = safeParts(trackParts)?.join("/");
  if (!id || !(await isInLibrary(userId, id))) return null;
  const dir = resolveInside(userStemsRoot(userId), trackParts);
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const match = fs
    .readdirSync(dir)
    .find((name) => name.toLowerCase() === `${stem}.wav`);
  if (!match) return null;
  const full = path.resolve(dir, match);
  if (!full.startsWith(path.resolve(dir) + path.sep)) return null;
  const size = fs.statSync(full).size;
  return size > 0 ? full : null;
}
