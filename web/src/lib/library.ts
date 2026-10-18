import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { tracks } from "@/db/schema";
import { storagePrefixFor } from "./paths";
import { fetchYoutubeMeta, isYoutubeUrl } from "./youtubeMeta";

export type TrackStatus = "queued" | "processing" | "ready" | "failed";

export type LibraryEntry = {
  id: string;
  slug: string;
  title: string;
  artist: string;
  url?: string | null;
  source: string;
  sourcePath?: string | null;
  status: TrackStatus;
  storagePrefix: string;
  addedAt: string;
  error?: string | null;
};

function rowToEntry(row: typeof tracks.$inferSelect): LibraryEntry {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    artist: row.artist,
    url: row.url,
    source: row.source,
    sourcePath: row.sourcePath,
    status: row.status as TrackStatus,
    storagePrefix: row.storagePrefix,
    addedAt: row.createdAt.toISOString(),
    error: row.error,
  };
}

export async function readLibraryEntries(userId: string): Promise<LibraryEntry[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tracks)
    .where(eq(tracks.userId, userId))
    .orderBy(desc(tracks.createdAt));
  return rows.map(rowToEntry);
}

export async function getLibraryEntry(
  userId: string,
  id: string,
): Promise<LibraryEntry | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.userId, userId), eq(tracks.id, id)))
    .limit(1);
  return row ? rowToEntry(row) : null;
}

export async function getLibraryEntryBySlug(
  userId: string,
  slug: string,
): Promise<LibraryEntry | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.userId, userId), eq(tracks.slug, slug)))
    .limit(1);
  return row ? rowToEntry(row) : null;
}

export async function isInLibrary(userId: string, idOrSlug: string): Promise<boolean> {
  if (await getLibraryEntry(userId, idOrSlug)) return true;
  return Boolean(await getLibraryEntryBySlug(userId, idOrSlug));
}

export async function registerLibraryTrack(
  userId: string,
  entry: {
    slug: string;
    title: string;
    artist: string;
    url?: string | null;
    source?: string;
    sourcePath?: string | null;
    status?: TrackStatus;
    error?: string | null;
  },
): Promise<LibraryEntry> {
  const db = getDb();
  const existing = await getLibraryEntryBySlug(userId, entry.slug);
  const storagePrefix = storagePrefixFor(userId, entry.slug);
  const now = new Date();

  if (existing) {
    const [row] = await db
      .update(tracks)
      .set({
        title: entry.title,
        artist: entry.artist,
        url: entry.url ?? existing.url,
        source: entry.source ?? existing.source,
        sourcePath:
          entry.sourcePath !== undefined ? entry.sourcePath : existing.sourcePath,
        status: entry.status ?? existing.status,
        error: entry.error !== undefined ? entry.error : existing.error,
        storagePrefix,
        updatedAt: now,
      })
      .where(and(eq(tracks.userId, userId), eq(tracks.id, existing.id)))
      .returning();
    return rowToEntry(row!);
  }

  const [row] = await db
    .insert(tracks)
    .values({
      userId,
      slug: entry.slug,
      title: entry.title,
      artist: entry.artist,
      url: entry.url ?? null,
      source: entry.source ?? "youtube",
      sourcePath: entry.sourcePath ?? null,
      status: entry.status ?? "ready",
      error: entry.error ?? null,
      storagePrefix,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rowToEntry(row!);
}

export async function updateLibraryTrack(
  userId: string,
  id: string,
  patch: Partial<
    Pick<LibraryEntry, "status" | "title" | "artist" | "url" | "error" | "sourcePath">
  >,
): Promise<LibraryEntry | null> {
  const db = getDb();
  const [row] = await db
    .update(tracks)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(tracks.userId, userId), eq(tracks.id, id)))
    .returning();
  return row ? rowToEntry(row) : null;
}

export async function addYoutubeToLibrary(
  userId: string,
  url: string,
): Promise<
  | { ok: true; entry: LibraryEntry }
  | { ok: false; error: string; status: number; entry?: LibraryEntry }
> {
  if (!isYoutubeUrl(url)) {
    return {
      ok: false,
      error: "Paste a YouTube watch, Shorts, or youtu.be link.",
      status: 400,
    };
  }
  const meta = fetchYoutubeMeta(url);
  if (!meta.ok) return { ok: false, error: meta.error, status: 400 };

  const existing = await getLibraryEntryBySlug(userId, meta.meta.trackId);
  if (existing) {
    return {
      ok: false,
      error: "That song is already in your library.",
      status: 409,
      entry: existing,
    };
  }

  const entry = await registerLibraryTrack(userId, {
    slug: meta.meta.trackId,
    title: meta.meta.title,
    artist: meta.meta.artist,
    url: meta.meta.url,
    source: "youtube",
    status: "queued",
  });
  return { ok: true, entry };
}
