import { spawnSync } from "node:child_process";

import { projectRoot } from "./paths";
import { resolveYtDlp, ytDlpHelp } from "./runtime";

export function slugify(text: string): string {
  const ascii = text.normalize("NFKD").replace(/\p{M}/gu, "");
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function isYoutubeUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    const allowed = new Set([
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "www.youtu.be",
    ]);
    if (!allowed.has(host)) return false;
    if (host === "youtu.be" || host === "www.youtu.be") {
      return parsed.pathname.replace(/^\//, "").length > 0;
    }
    if (parsed.pathname === "/watch" || parsed.pathname === "/watch/") {
      return Boolean(parsed.searchParams.get("v"));
    }
    return (
      parsed.pathname.startsWith("/shorts/") ||
      parsed.pathname.startsWith("/live/") ||
      parsed.pathname.startsWith("/embed/")
    );
  } catch {
    return false;
  }
}

export type YoutubeMeta = {
  title: string;
  artist: string;
  videoId: string;
  trackId: string;
  url: string;
};

export function fetchYoutubeMeta(url: string):
  | { ok: true; meta: YoutubeMeta }
  | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "Paste a YouTube link." };
  if (!isYoutubeUrl(trimmed)) {
    return {
      ok: false,
      error: "Paste a YouTube watch, Shorts, or youtu.be link.",
    };
  }

  const cmd = resolveYtDlp();
  const result = spawnSync(
    cmd[0],
    [
      ...cmd.slice(1),
      trimmed,
      "--skip-download",
      "--no-playlist",
      "--quiet",
      "--no-warnings",
      "--dump-single-json",
    ],
    {
      encoding: "utf8",
      cwd: projectRoot(),
      timeout: 60_000,
      env: process.env,
    },
  );

  if (result.error) {
    return { ok: false, error: ytDlpHelp() };
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim().split("\n").at(-1) || "";
    if (err.includes("No module named yt_dlp") || err.includes("No module named 'yt_dlp'")) {
      return { ok: false, error: ytDlpHelp() };
    }
    return {
      ok: false,
      error: err || "Could not read that YouTube link.",
    };
  }

  try {
    const info = JSON.parse(result.stdout) as Record<string, unknown>;
    const title = String(info.title || "YouTube track");
    const artist = String(
      info.artist || info.uploader || info.channel || "YouTube",
    );
    const videoId = String(info.id || slugify(title));
    const trackId = ["youtube", slugify(artist), slugify(title)].join("/");
    return {
      ok: true,
      meta: { title, artist, videoId, trackId, url: trimmed },
    };
  } catch {
    return { ok: false, error: "Could not parse YouTube video info." };
  }
}
