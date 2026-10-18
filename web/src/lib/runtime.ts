import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { projectRoot } from "./paths";

function which(bin: string): string | null {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const found = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return found || null;
}

function pythonHasModule(python: string, moduleName: string): boolean {
  const result = spawnSync(
    python,
    ["-c", `import ${moduleName}`],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

export function resolvePython(): string {
  if (process.env.STEMSPLIT_PYTHON) return process.env.STEMSPLIT_PYTHON;

  const candidates = [
    path.join(projectRoot(), ".venv", "bin", "python"),
    path.join(projectRoot(), ".venv", "bin", "python3"),
    path.join(projectRoot(), "venv", "bin", "python"),
    path.join(projectRoot(), ".venv", "Scripts", "python.exe"),
    which("python3"),
    which("python"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) || candidate === "python3" || candidate === "python") {
      return candidate;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

/** Prefer a real yt-dlp binary; only use `python -m yt_dlp` when that module exists. */
export function resolveYtDlp(): string[] {
  if (process.env.STEMSPLIT_YT_DLP) return [process.env.STEMSPLIT_YT_DLP];

  const binaryCandidates = [
    path.join(projectRoot(), ".venv", "bin", "yt-dlp"),
    path.join(projectRoot(), "venv", "bin", "yt-dlp"),
    path.join(projectRoot(), ".venv", "Scripts", "yt-dlp.exe"),
    which("yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of binaryCandidates) {
    if (fs.existsSync(candidate)) return [candidate];
  }

  const python = resolvePython();
  if (pythonHasModule(python, "yt_dlp")) {
    return [python, "-m", "yt_dlp"];
  }

  const pathYt = which("yt-dlp");
  if (pathYt) return [pathYt];

  // Last resort — caller will surface the import error if this Python lacks yt_dlp.
  return [python, "-m", "yt_dlp"];
}

export function ytDlpHelp(): string {
  return (
    "yt-dlp was not found. Install it with `brew install yt-dlp`, " +
    "or create a venv in the repo (`python3 -m venv .venv && .venv/bin/pip install -e .`)."
  );
}
