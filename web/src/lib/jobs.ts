import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { jobs, userLocks } from "@/db/schema";
import type { JobRecord, JobStep } from "./jobTypes";
import {
  getLibraryEntry,
  registerLibraryTrack,
  updateLibraryTrack,
} from "./library";
import {
  projectRoot,
  songsRoot,
  stemsRoot,
  userSongsRoot,
  userStemsRoot,
} from "./paths";
import { resolvePython } from "./runtime";
import { isYoutubeUrl } from "./youtubeMeta";

export type { JobRecord, JobStep } from "./jobTypes";
export { projectRoot, songsRoot };

const YOUTUBE_STEPS: { key: string; label: string }[] = [
  { key: "validate", label: "Checking link" },
  { key: "metadata", label: "Reading video info" },
  { key: "download", label: "Downloading audio" },
  { key: "load", label: "Loading audio" },
  { key: "four_stem", label: "Separating vocals, drums, bass" },
  { key: "six_stem", label: "Separating guitar and piano" },
  { key: "save", label: "Writing stem files" },
  { key: "done", label: "Ready" },
];

const LOCAL_STEPS: { key: string; label: string }[] = [
  { key: "validate", label: "Checking file" },
  { key: "metadata", label: "Reading file info" },
  { key: "download", label: "Preparing local audio" },
  { key: "load", label: "Loading audio" },
  { key: "four_stem", label: "Separating vocals, drums, bass" },
  { key: "six_stem", label: "Separating guitar and piano" },
  { key: "save", label: "Writing stem files" },
  { key: "done", label: "Ready" },
];

function utcStamp(date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function rowToJob(row: typeof jobs.$inferSelect): JobRecord {
  return {
    id: row.id,
    url: row.url,
    audioPath: row.audioPath,
    status: row.status as JobRecord["status"],
    step: row.step,
    stepKey: row.stepKey,
    steps: row.steps as JobStep[],
    title: row.title,
    artist: row.artist,
    trackId: row.trackId,
    href: row.href,
    error: row.error,
    detail: row.detail ?? undefined,
    updatedAt: utcStamp(row.updatedAt),
    pid: row.pid ?? undefined,
  };
}

export async function syncJobToLibrary(
  userId: string,
  job: JobRecord,
): Promise<void> {
  if (job.status === "done" && job.trackId && job.title) {
    const existing = await getLibraryEntry(userId, job.trackId);
    if (existing) {
      await updateLibraryTrack(userId, job.trackId, {
        status: "ready",
        title: job.title,
        artist: job.artist ?? existing.artist,
        url: job.url,
        error: null,
      });
      return;
    }
    if (job.href) {
      const slug = job.href.replace(/^\/tracks\//, "").split("/").map(decodeURIComponent).join("/");
      await registerLibraryTrack(userId, {
        slug,
        title: job.title,
        artist: job.artist ?? "YouTube",
        url: job.url,
        source: "youtube",
        status: "ready",
        error: null,
      });
    }
    return;
  }
  if (!job.trackId) return;
  if (job.status === "failed") {
    await updateLibraryTrack(userId, job.trackId, {
      status: "failed",
      error: job.error,
    });
    return;
  }
  if (job.status === "queued" || job.status === "running") {
    await updateLibraryTrack(userId, job.trackId, {
      status: "processing",
      error: null,
    });
  }
}

function createQueuedSteps(kind: "youtube" | "local"): JobStep[] {
  const defs = kind === "local" ? LOCAL_STEPS : YOUTUBE_STEPS;
  return defs.map((step) => ({
    key: step.key,
    label: step.label,
    status: "pending" as const,
  }));
}

export async function writeJob(
  userId: string,
  job: JobRecord,
): Promise<JobRecord> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .insert(jobs)
    .values({
      id: job.id,
      userId,
      trackId: job.trackId,
      url: job.url,
      audioPath: job.audioPath ?? null,
      status: job.status,
      step: job.step,
      stepKey: job.stepKey,
      steps: job.steps,
      title: job.title,
      artist: job.artist,
      href: job.href,
      error: job.error,
      detail: job.detail ?? null,
      pid: job.pid ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: jobs.id,
      set: {
        trackId: job.trackId,
        url: job.url,
        audioPath: job.audioPath ?? null,
        status: job.status,
        step: job.step,
        stepKey: job.stepKey,
        steps: job.steps,
        title: job.title,
        artist: job.artist,
        href: job.href,
        error: job.error,
        detail: job.detail ?? null,
        pid: job.pid ?? null,
        updatedAt: now,
      },
    })
    .returning();
  return rowToJob(row!);
}

export async function readJob(
  userId: string,
  id: string,
): Promise<JobRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.id, id)))
    .limit(1);
  if (!row) return null;
  const job = rowToJob(row);
  await syncJobToLibrary(userId, job);
  return job;
}

export async function listJobs(userId: string): Promise<JobRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.userId, userId))
    .orderBy(desc(jobs.updatedAt));
  return rows.map(rowToJob);
}

export async function findActiveJob(userId: string): Promise<JobRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(jobs.updatedAt))
    .limit(1);
  return row ? rowToJob(row) : null;
}

async function acquireLock(userId: string, jobId: string): Promise<boolean> {
  const db = getDb();
  const active = await findActiveJob(userId);
  if (active && active.id !== jobId) {
    const [lock] = await db
      .select()
      .from(userLocks)
      .where(eq(userLocks.userId, userId))
      .limit(1);
    if (lock) {
      const lockedJob = await readJob(userId, lock.jobId);
      if (
        lockedJob &&
        (lockedJob.status === "queued" || lockedJob.status === "running")
      ) {
        return false;
      }
      await db.delete(userLocks).where(eq(userLocks.userId, userId));
    }
  }

  try {
    await db.insert(userLocks).values({ userId, jobId });
    return true;
  } catch {
    const [lock] = await db
      .select()
      .from(userLocks)
      .where(eq(userLocks.userId, userId))
      .limit(1);
    if (!lock) return false;
    if (lock.jobId === jobId) return true;
    const lockedJob = await readJob(userId, lock.jobId);
    if (!lockedJob || lockedJob.status === "done" || lockedJob.status === "failed") {
      await db.delete(userLocks).where(eq(userLocks.userId, userId));
      try {
        await db.insert(userLocks).values({ userId, jobId });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function releaseLock(userId: string, jobId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(userLocks)
    .where(and(eq(userLocks.userId, userId), eq(userLocks.jobId, jobId)));
}

/** Start a stem job. Demucs always runs on this machine (the user's PC when the app is local). */
export async function startStemJob(
  userId: string,
  input: { url?: string; trackId?: string },
): Promise<
  | { ok: true; job: JobRecord }
  | { ok: false; error: string; status: number; job?: JobRecord }
> {
  let trimmed = input.url?.trim() ?? "";
  let libraryTrackId: string | null = input.trackId ?? null;
  let audioPath: string | null = null;
  let kind: "youtube" | "local" = "youtube";
  let titleHint: string | null = null;
  let artistHint: string | null = null;
  let slugHint: string | null = null;

  if (libraryTrackId) {
    const entry = await getLibraryEntry(userId, libraryTrackId);
    if (!entry) {
      return { ok: false, error: "That song is not in your library.", status: 404 };
    }
    if (entry.status === "ready") {
      return {
        ok: false,
        error: "This song is already processed.",
        status: 409,
      };
    }
    titleHint = entry.title;
    artistHint = entry.artist;
    slugHint = entry.slug;
    if (entry.source === "local") {
      if (!entry.sourcePath) {
        return {
          ok: false,
          error: "This local song is missing its audio file path.",
          status: 400,
        };
      }
      kind = "local";
      audioPath = entry.sourcePath;
      trimmed = "";
    } else {
      if (!entry.url) {
        return {
          ok: false,
          error: "This library song has no YouTube link to process.",
          status: 400,
        };
      }
      trimmed = entry.url;
    }
  }

  if (kind === "youtube") {
    if (!trimmed) {
      return { ok: false, error: "Paste a YouTube link or upload a local file.", status: 400 };
    }
    if (!isYoutubeUrl(trimmed)) {
      return {
        ok: false,
        error: "Paste a YouTube watch, Shorts, or youtu.be link.",
        status: 400,
      };
    }
  }

  const active = await findActiveJob(userId);
  if (active) {
    return {
      ok: false,
      error: "Another song is already processing. Wait for it to finish.",
      status: 409,
      job: active,
    };
  }

  const steps = createQueuedSteps(kind);
  const job: JobRecord = {
    id: randomUUID(),
    url: trimmed,
    audioPath,
    status: "queued",
    step: 0,
    stepKey: steps[0]!.key,
    steps,
    title: titleHint,
    artist: artistHint,
    trackId: libraryTrackId,
    href: null,
    error: null,
    updatedAt: utcStamp(),
  };

  if (libraryTrackId) {
    await updateLibraryTrack(userId, libraryTrackId, {
      status: "processing",
      error: null,
    });
  }

  if (!(await acquireLock(userId, job.id))) {
    if (libraryTrackId) {
      await updateLibraryTrack(userId, libraryTrackId, { status: "queued" });
    }
    const again = await findActiveJob(userId);
    return {
      ok: false,
      error: "Another song is already processing. Wait for it to finish.",
      status: 409,
      job: again ?? undefined,
    };
  }

  await writeJob(userId, job);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    await releaseLock(userId, job.id);
    job.status = "failed";
    job.error = "DATABASE_URL is not configured.";
    await writeJob(userId, job);
    return { ok: false, error: job.error, status: 500, job };
  }

  const python = resolvePython();
  const args = [
    "-m",
    "stemsplit.youtube_job",
    "--job-id",
    job.id,
    "--user-id",
    userId,
    "--database-url",
    databaseUrl,
    "--songs",
    userSongsRoot(userId),
    "--stems",
    userStemsRoot(userId),
  ];
  if (kind === "local" && audioPath) {
    args.push("--audio", audioPath);
  } else {
    args.push("--url", trimmed);
  }
  if (libraryTrackId) {
    args.push("--track-id", libraryTrackId);
  }
  if (slugHint) {
    args.push("--slug", slugHint);
  }
  if (process.env.STEMSPLIT_CPU === "1") args.push("--cpu");
  if (process.env.STEMSPLIT_QUALITY === "max") {
    args.push("--quality", "max");
  }
  if (process.env.STEMSPLIT_COOKIES_FROM_BROWSER) {
    args.push("--cookies-from-browser", process.env.STEMSPLIT_COOKIES_FROM_BROWSER);
  }

  let child: ChildProcess;
  try {
    child = spawn(python, args, {
      cwd: projectRoot(),
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        DATABASE_URL: databaseUrl,
      },
    });
  } catch (error) {
    await releaseLock(userId, job.id);
    job.status = "failed";
    job.error =
      error instanceof Error ? error.message : "Could not start the local worker.";
    await writeJob(userId, job);
    return { ok: false, error: job.error, status: 500, job };
  }

  child.unref();
  job.pid = child.pid;
  job.status = "running";
  await writeJob(userId, job);

  child.on("exit", (code) => {
    void (async () => {
      await releaseLock(userId, job.id);
      const latest = await readJob(userId, job.id);
      if (!latest) return;
      if (latest.status === "queued" || latest.status === "running") {
        latest.status = code === 0 ? "done" : "failed";
        if (code !== 0 && !latest.error) {
          latest.error = `Worker exited with code ${code ?? "unknown"}`;
        }
        await writeJob(userId, latest);
      }
      await syncJobToLibrary(userId, latest);
    })();
  });

  return { ok: true, job };
}

/** @deprecated use startStemJob */
export const startYoutubeJob = startStemJob;

/** Root stems folder (for diagnostics). */
export function stemsRootPath(): string {
  return stemsRoot();
}
