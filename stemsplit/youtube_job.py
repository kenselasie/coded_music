"""Download a YouTube URL and separate it, writing step progress for the web UI."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import unicodedata
import uuid
import os
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}

STEPS: list[tuple[str, str]] = [
    ("validate", "Checking link"),
    ("metadata", "Reading video info"),
    ("download", "Downloading audio"),
    ("load", "Loading audio"),
    ("four_stem", "Separating vocals, drums, bass"),
    ("six_stem", "Separating guitar and piano"),
    ("save", "Writing stem files"),
    ("done", "Ready"),
]


def utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def slugify(text: str) -> str:
    ascii_text = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug or "untitled"


def is_youtube_url(value: str) -> bool:
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        return False
    if host in {"youtu.be", "www.youtu.be"}:
        return bool(parsed.path.strip("/"))
    if parsed.path.rstrip("/") == "/watch":
        return bool(parse_qs(parsed.query).get("v"))
    if parsed.path.startswith("/shorts/") or parsed.path.startswith("/live/"):
        return bool(parsed.path.strip("/").split("/")[-1])
    if parsed.path.startswith("/embed/"):
        return bool(parsed.path.strip("/").split("/")[-1])
    return False


def video_id(value: str) -> str | None:
    parsed = urlparse(value.strip())
    host = (parsed.hostname or "").lower()
    if host in {"youtu.be", "www.youtu.be"}:
        return parsed.path.strip("/").split("/")[0] or None
    if parsed.path.rstrip("/") == "/watch":
        values = parse_qs(parsed.query).get("v")
        return values[0] if values else None
    for prefix in ("/shorts/", "/live/", "/embed/"):
        if parsed.path.startswith(prefix):
            return parsed.path[len(prefix) :].split("/")[0] or None
    return None


def initial_job(job_id: str, url: str) -> dict[str, Any]:
    return {
        "id": job_id,
        "url": url,
        "status": "queued",
        "step": 0,
        "stepKey": STEPS[0][0],
        "steps": [
            {"key": key, "label": label, "status": "pending"} for key, label in STEPS
        ],
        "title": None,
        "artist": None,
        "trackId": None,
        "href": None,
        "error": None,
        "updatedAt": utc_now(),
    }


def write_job(path: Path, job: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    job["updatedAt"] = utc_now()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def set_step(job: dict[str, Any], key: str, *, detail: str | None = None) -> None:
    keys = [item[0] for item in STEPS]
    index = keys.index(key)
    job["step"] = index
    job["stepKey"] = key
    job["status"] = "running" if key != "done" else "done"
    for i, step in enumerate(job["steps"]):
        if i < index:
            step["status"] = "done"
        elif i == index:
            step["status"] = "done" if key == "done" else "active"
        else:
            step["status"] = "pending"
    if detail:
        job["detail"] = detail
    elif "detail" in job and key != "done":
        job.pop("detail", None)


def fail_job(job: dict[str, Any], message: str) -> None:
    job["status"] = "failed"
    job["error"] = message
    for step in job["steps"]:
        if step["status"] == "active":
            step["status"] = "error"
            break


Progress = Callable[..., None]


def fetch_metadata(url: str) -> dict[str, Any]:
    import yt_dlp

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)
    if not isinstance(info, dict):
        raise RuntimeError("Could not read video info from YouTube.")
    return info


def download_audio(
    url: str,
    destination: Path,
    *,
    yt_dlp: list[str],
    max_duration: int,
    timeout: int,
    extra_args: list[str] | None = None,
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        *yt_dlp,
        *(extra_args or []),
        url,
        "--no-playlist",
        "--match-filter",
        f"duration<{max_duration} & !is_live",
        "-f",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "best",
        "--embed-metadata",
        "--no-overwrites",
        "--no-progress",
        "--quiet",
        "--no-warnings",
        "--output",
        str(destination.with_suffix(".%(ext)s")),
        "--print",
        "after_move:filepath",
    ]
    import subprocess

    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Download timed out after {timeout}s") from exc

    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    if proc.returncode == 0 and lines:
        path = Path(lines[-1])
        if path.is_file() and path.stat().st_size > 0:
            return path

    # yt-dlp may leave the file even when print path is odd
    matches = sorted(
        destination.parent.glob(f"{destination.name}.*"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    for match in matches:
        if match.is_file() and match.stat().st_size > 0:
            return match

    stderr = proc.stderr.strip().splitlines()
    detail = stderr[-1] if stderr else f"yt-dlp exit {proc.returncode}"
    raise RuntimeError(detail)


def run_job(
    *,
    url: str | None = None,
    audio_file: Path | None = None,
    songs_dir: Path,
    stems_dir: Path,
    quality: str = "standard",
    allow_cpu: bool = False,
    shifts: int | None = None,
    overlap: float = 0.25,
    segment: int | None = None,
    keep_models: bool = False,
    float32: bool = False,
    max_duration: int = 720,
    timeout: int = 600,
    cookies_from_browser: str | None = None,
    cookies: Path | None = None,
    relative_slug: str | None = None,
    progress: Progress | None = None,
) -> dict[str, Any]:
    def report(key: str, detail: str | None = None, **fields: Any) -> None:
        if progress:
            progress(key, detail, **fields)

    report("validate")
    local_audio = Path(audio_file).expanduser().resolve() if audio_file else None
    if local_audio is not None:
        if not local_audio.is_file() or local_audio.stat().st_size <= 0:
            raise ValueError("Local audio file is missing or empty.")
        title = slugify(local_audio.stem).replace("-", " ").title() or "Local track"
        # Prefer the human filename over a slugified title
        title = local_audio.stem.replace("_", " ").replace("-", " ").strip() or title
        artist = "Local file"
        vid = slugify(local_audio.stem)[:12] or uuid.uuid4().hex[:8]
        if relative_slug:
            relative = Path(*[part for part in relative_slug.split("/") if part])
        else:
            relative = Path("local") / slugify(artist) / slugify(title)
        stem_folder = stems_dir / relative
        report("metadata", title, title=title, artist=artist)
        report("download", title, title=title, artist=artist)
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg is not on PATH.")
        audio_file = local_audio
    else:
        if not url or not is_youtube_url(url):
            raise ValueError("Paste a YouTube watch, Shorts, or youtu.be link.")

        report("metadata")
        info = fetch_metadata(url)
        title = str(info.get("title") or "YouTube track")
        artist = str(
            info.get("artist")
            or info.get("uploader")
            or info.get("channel")
            or "YouTube"
        )
        duration = info.get("duration")
        if isinstance(duration, (int, float)) and duration >= max_duration:
            raise ValueError(
                f"This video is longer than {max_duration // 60} minutes; pick a single song."
            )
        if info.get("is_live"):
            raise ValueError("Live streams cannot be separated.")

        vid = video_id(url) or slugify(str(info.get("id") or uuid.uuid4().hex[:8]))
        track_slug = slugify(title)
        if relative_slug:
            relative = Path(*[part for part in relative_slug.split("/") if part])
        else:
            relative = Path("youtube") / slugify(artist) / track_slug
        audio_path = songs_dir / relative
        stem_folder = stems_dir / relative
        report("metadata", title, title=title, artist=artist)

        report("download", title, title=title, artist=artist)
        from stemsplit.download import resolve_yt_dlp

        yt_dlp = resolve_yt_dlp("yt-dlp")
        if yt_dlp is None:
            raise RuntimeError("yt-dlp is not installed. Run `pip install yt-dlp`.")
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg is not on PATH.")

        extra_args: list[str] = []
        if cookies_from_browser:
            extra_args += ["--cookies-from-browser", cookies_from_browser]
        if cookies:
            extra_args += ["--cookies", str(cookies.expanduser())]

        audio_file = download_audio(
            url,
            audio_path,
            yt_dlp=yt_dlp,
            max_duration=max_duration,
            timeout=timeout,
            extra_args=extra_args,
        )

    import torch

    from stemsplit.pipeline import (
        MODEL_CHANNELS,
        MODEL_SAMPLERATE,
        CudaOOMError,
        SeparatorPool,
        load_track,
        save_stems,
        separate_four_stem_ensemble,
        split_other_into_guitar_piano,
    )
    from stemsplit.stems import merge_six_stems

    if torch.cuda.is_available():
        device = "cuda"
    elif allow_cpu:
        device = "cpu"
    else:
        raise RuntimeError(
            "No CUDA GPU found. Install a CUDA PyTorch build, or pass --cpu."
        )

    report("load")
    pool = SeparatorPool(
        device=device,
        shifts=10 if quality == "max" and shifts is None else (shifts if shifts is not None else 5),
        overlap=overlap,
        segment=segment,
        keep_models=keep_models,
        progress=False,
    )
    wav = load_track(audio_file, MODEL_SAMPLERATE, MODEL_CHANNELS)

    report("four_stem")
    try:
        four, rate = separate_four_stem_ensemble(
            pool, wav, MODEL_SAMPLERATE, ensemble=(quality == "max")
        )
        report("six_stem")
        six = split_other_into_guitar_piano(pool, four["other"], rate)
        stems = merge_six_stems(four, six)
    except CudaOOMError:
        raise
    except Exception as exc:  # noqa: BLE001
        if "out of memory" in str(exc).lower():
            raise CudaOOMError(
                "GPU ran out of memory. Re-run with a shorter segment (7)."
            ) from exc
        raise

    report("save")
    dest = {
        name: stem_folder / f"{name}.wav"
        for name in ("vocals", "drums", "bass", "guitar", "piano", "other")
    }
    save_stems(stems, dest, rate, float32=float32)
    report("done")

    track_id = relative.as_posix()
    return {
        "title": title,
        "artist": artist,
        "videoId": vid,
        "trackId": track_id,
        "href": "/tracks/" + "/".join(part for part in relative.parts),
        "audioPath": str(audio_file),
        "stemFolder": str(stem_folder),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stemsplit-youtube",
        description="Download one YouTube song and write six stems, with DB progress.",
    )
    parser.add_argument("--url", default=None, help="YouTube URL.")
    parser.add_argument(
        "--audio",
        type=Path,
        default=None,
        help="Local audio file on this machine (skips YouTube download).",
    )
    parser.add_argument("--job-id", required=True, help="Job UUID in Postgres.")
    parser.add_argument("--user-id", required=True, help="Owner user UUID.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres URL (defaults to DATABASE_URL).",
    )
    parser.add_argument(
        "--track-id",
        default=None,
        help="Existing library track UUID to update.",
    )
    parser.add_argument(
        "--slug",
        default=None,
        help="Library slug for stem output folder (e.g. local/artist/title).",
    )
    parser.add_argument(
        "--job-file",
        type=Path,
        default=None,
        help="Optional JSON mirror for debugging.",
    )
    parser.add_argument("--songs", type=Path, default=Path("songs"), help="Download folder.")
    parser.add_argument("--stems", type=Path, default=Path("stems"), help="Stem output folder.")
    parser.add_argument("--quality", choices=("standard", "max"), default="standard")
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument("--shifts", type=int, default=None)
    parser.add_argument("--overlap", type=float, default=0.25)
    parser.add_argument("--segment", type=int, default=None)
    parser.add_argument("--keep-models", action="store_true")
    parser.add_argument("--float32", action="store_true")
    parser.add_argument("--max-duration", type=int, default=720)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--cookies-from-browser", default=None)
    parser.add_argument("--cookies", type=Path, default=None)
    return parser


def run(argv: list[str] | None = None) -> int:
    from stemsplit.pg_jobs import (
        connect,
        load_job,
        release_user_lock,
        set_track_status,
        write_job_row,
    )

    parser = build_parser()
    args = parser.parse_args(argv)
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL / --database-url is required.", file=sys.stderr)
        return 2

    if not args.url and not args.audio:
        print("Provide --url or --audio.", file=sys.stderr)
        return 2

    job_id = args.job_id
    user_id = args.user_id
    conn = connect(database_url)
    try:
        job = load_job(conn, job_id)
        if job is None:
            job = initial_job(job_id, args.url or "")
            job["userId"] = user_id
            job["trackId"] = args.track_id
        job["url"] = args.url or job.get("url") or ""
        if args.audio:
            job["audioPath"] = str(Path(args.audio).expanduser().resolve())
        job["status"] = "running"
        if args.track_id:
            job["trackId"] = args.track_id

        job_path = args.job_file.expanduser().resolve() if args.job_file else None

        def progress(key: str, detail: str | None = None, **fields: Any) -> None:
            set_step(job, key, detail=detail)
            for name, value in fields.items():
                if value is not None:
                    job[name] = value
            write_job_row(conn, job)
            if job_path is not None:
                write_job(job_path, job)

        try:
            if job.get("trackId"):
                set_track_status(
                    conn,
                    user_id=user_id,
                    track_id=job["trackId"],
                    slug=None,
                    status="processing",
                    error=None,
                )
            result = run_job(
                url=args.url,
                audio_file=args.audio,
                songs_dir=args.songs.expanduser().resolve(),
                stems_dir=args.stems.expanduser().resolve(),
                quality=args.quality,
                allow_cpu=args.cpu,
                shifts=args.shifts,
                overlap=args.overlap,
                segment=args.segment,
                keep_models=args.keep_models,
                float32=args.float32,
                max_duration=args.max_duration,
                timeout=args.timeout,
                cookies_from_browser=args.cookies_from_browser,
                cookies=args.cookies,
                relative_slug=args.slug,
                progress=progress,
            )
        except Exception as exc:  # noqa: BLE001 — surface to the DB for the UI
            fail_job(job, str(exc).splitlines()[0])
            write_job_row(conn, job)
            if job_path is not None:
                write_job(job_path, job)
            if job.get("trackId"):
                set_track_status(
                    conn,
                    user_id=user_id,
                    track_id=job["trackId"],
                    slug=None,
                    status="failed",
                    error=job.get("error"),
                )
            release_user_lock(conn, user_id, job_id)
            print(exc, file=sys.stderr)
            return 1

        slug = result["trackId"]
        track_uuid = set_track_status(
            conn,
            user_id=user_id,
            track_id=job.get("trackId"),
            slug=slug,
            status="ready",
            title=result["title"],
            artist=result["artist"],
            url=args.url,
            error=None,
            storage_prefix=f"{user_id}/{slug}",
        )
        job.update(
            {
                "title": result["title"],
                "artist": result["artist"],
                "trackId": track_uuid or job.get("trackId"),
                "href": result["href"],
            }
        )
        set_step(job, "done")
        write_job_row(conn, job)
        if job_path is not None:
            write_job(job_path, job)
        release_user_lock(conn, user_id, job_id)
        print(result["stemFolder"])
        return 0
    finally:
        conn.close()


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
