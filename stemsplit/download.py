"""Download the song catalog with yt-dlp into a folder stemsplit can read."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from importlib import resources
from pathlib import Path

import yaml

from stemsplit import AUDIO_SUFFIXES

# yt-dlp exits 101 when --max-downloads stops it; that is the success path here.
MAX_DOWNLOADS_EXIT = 101
DEFAULT_MAX_DURATION = 720  # seconds; skips album uploads, mixes, live sets
SEARCH_RESULTS = 5


@dataclass(frozen=True)
class Song:
    genre: str
    artist: str
    title: str

    @property
    def query(self) -> str:
        return f"{self.artist} {self.title} official audio"

    @property
    def slug(self) -> str:
        return slugify(self.title)

    def target_dir(self, root: Path) -> Path:
        return root / slugify(self.genre) / slugify(self.artist)

    def label(self) -> str:
        return f"{self.genre}/{self.artist} - {self.title}"


def slugify(text: str) -> str:
    ascii_text = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug or "untitled"


def default_catalog_text() -> str:
    return resources.files("stemsplit").joinpath("catalog.yaml").read_text(
        encoding="utf-8"
    )


def parse_catalog(text: str) -> list[Song]:
    data = yaml.safe_load(text) or {}
    genres = data.get("genres")
    if not isinstance(genres, dict) or not genres:
        raise ValueError("catalog needs a top-level 'genres' mapping")

    songs: list[Song] = []
    seen: set[tuple[str, str]] = set()
    for genre, artists in genres.items():
        if not isinstance(artists, dict):
            raise ValueError(f"genre {genre!r} must map artists to title lists")
        for artist, titles in artists.items():
            if not isinstance(titles, list):
                raise ValueError(f"{genre}/{artist} must be a list of titles")
            for title in titles:
                song = Song(str(genre), str(artist), str(title))
                key = (slugify(song.artist), song.slug)
                if key in seen:
                    raise ValueError(f"duplicate song {song.label()}")
                seen.add(key)
                songs.append(song)
    return songs


def load_catalog(path: Path | None) -> list[Song]:
    text = path.read_text(encoding="utf-8") if path else default_catalog_text()
    return parse_catalog(text)


def filter_songs(
    songs: list[Song],
    *,
    genres: list[str] | None,
    artists: list[str] | None,
    limit: int | None,
) -> list[Song]:
    wanted_genres = {slugify(g) for g in genres} if genres else None
    wanted_artists = {slugify(a) for a in artists} if artists else None
    picked = [
        s
        for s in songs
        if (wanted_genres is None or slugify(s.genre) in wanted_genres)
        and (wanted_artists is None or slugify(s.artist) in wanted_artists)
    ]
    return picked[:limit] if limit is not None else picked


def existing_download(directory: Path, slug: str) -> Path | None:
    if not directory.is_dir():
        return None
    for candidate in directory.glob(f"{slug}.*"):
        if candidate.suffix.lower() in AUDIO_SUFFIXES and candidate.stat().st_size > 0:
            return candidate
    return None


def resolve_yt_dlp(preferred: str) -> list[str] | None:
    """Command prefix for yt-dlp: the named binary, else the module in this interpreter."""
    found = shutil.which(preferred)
    if found:
        return [found]
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return None
    return [sys.executable, "-m", "yt_dlp"]


def build_command(
    song: Song,
    root: Path,
    *,
    yt_dlp: list[str],
    max_duration: int,
    extra_args: list[str] | None = None,
) -> list[str]:
    outdir = song.target_dir(root)
    return [
        *yt_dlp,
        *(extra_args or []),
        f"ytsearch{SEARCH_RESULTS}:{song.query}",
        "--no-playlist",
        "--match-filter",
        f"duration<{max_duration} & !is_live",
        "--max-downloads",
        "1",
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
        str(outdir / f"{song.slug}.%(ext)s"),
        "--print",
        "after_move:filepath",
    ]


@dataclass
class Result:
    song: Song
    status: str  # "downloaded" | "skipped" | "failed"
    path: Path | None = None
    detail: str = ""


def download_song(
    song: Song,
    root: Path,
    *,
    yt_dlp: list[str],
    max_duration: int,
    timeout: int,
    extra_args: list[str] | None = None,
) -> Result:
    outdir = song.target_dir(root)
    existing = existing_download(outdir, song.slug)
    if existing:
        return Result(song, "skipped", existing, "already downloaded")

    outdir.mkdir(parents=True, exist_ok=True)
    cmd = build_command(
        song, root, yt_dlp=yt_dlp, max_duration=max_duration, extra_args=extra_args
    )
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired:
        return Result(song, "failed", None, f"timed out after {timeout}s")

    saved = existing_download(outdir, song.slug)
    if saved is not None and proc.returncode in (0, MAX_DOWNLOADS_EXIT):
        return Result(song, "downloaded", saved)

    stderr = proc.stderr.strip().splitlines()
    detail = stderr[-1] if stderr else f"yt-dlp exit {proc.returncode}"
    return Result(song, "failed", None, detail)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stemsplit-download",
        description=(
            "Download the song catalog with yt-dlp into songs/<genre>/<artist>/ "
            "so `stemsplit songs --recursive` can separate them."
        ),
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("songs"),
        help="Folder to download into (default: ./songs).",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        default=None,
        help="YAML catalog to use instead of the built-in one.",
    )
    parser.add_argument(
        "--genre",
        action="append",
        default=None,
        help="Only this genre (repeatable), e.g. --genre gospel.",
    )
    parser.add_argument(
        "--artist",
        action="append",
        default=None,
        help="Only this artist (repeatable), e.g. --artist 'Bruno Mars'.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after N songs from the filtered list.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=3,
        help="Parallel downloads (default 3).",
    )
    parser.add_argument(
        "--max-duration",
        type=int,
        default=DEFAULT_MAX_DURATION,
        help=f"Skip results longer than this many seconds (default {DEFAULT_MAX_DURATION}).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Per-song timeout in seconds (default 600).",
    )
    parser.add_argument(
        "--yt-dlp",
        default="yt-dlp",
        help="Path to the yt-dlp executable.",
    )
    parser.add_argument(
        "--cookies-from-browser",
        default=None,
        metavar="BROWSER",
        help=(
            "Use a logged-in browser's YouTube cookies (chrome, firefox, edge, ...). "
            "Fixes 'Sign in to confirm you're not a bot'."
        ),
    )
    parser.add_argument(
        "--cookies",
        type=Path,
        default=None,
        help="Netscape cookies.txt exported from a browser (alternative to --cookies-from-browser).",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print the songs that would be downloaded and exit.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the yt-dlp commands without running them.",
    )
    return parser


def run(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        songs = load_catalog(args.catalog)
    except (OSError, ValueError, yaml.YAMLError) as exc:
        print(f"catalog error: {exc}", file=sys.stderr)
        return 2

    songs = filter_songs(
        songs, genres=args.genre, artists=args.artist, limit=args.limit
    )
    if not songs:
        print("No songs match those filters.", file=sys.stderr)
        return 1

    root = args.output.expanduser().resolve()

    if args.list:
        for song in songs:
            print(f"{song.label()}  ->  {song.target_dir(root) / song.slug}.*")
        print(f"\n{len(songs)} songs")
        return 0

    yt_dlp = resolve_yt_dlp(args.yt_dlp) or [args.yt_dlp]
    extra_args: list[str] = []
    if args.cookies_from_browser:
        extra_args += ["--cookies-from-browser", args.cookies_from_browser]
    if args.cookies:
        extra_args += ["--cookies", str(args.cookies.expanduser())]

    if args.dry_run:
        for song in songs:
            cmd = build_command(
                song,
                root,
                yt_dlp=yt_dlp,
                max_duration=args.max_duration,
                extra_args=extra_args,
            )
            print(" ".join(_quote(part) for part in cmd))
        return 0

    if resolve_yt_dlp(args.yt_dlp) is None:
        print(
            f"{args.yt_dlp!r} not found. Install it with `pip install yt-dlp` "
            "or pass --yt-dlp /path/to/yt-dlp.",
            file=sys.stderr,
        )
        return 2
    if shutil.which("ffmpeg") is None:
        print("ffmpeg not found on PATH; yt-dlp needs it to extract audio.", file=sys.stderr)
        return 2

    print(f"Songs: {len(songs)}  workers: {args.workers}  output: {root}")
    started = time.perf_counter()
    counts = {"downloaded": 0, "skipped": 0, "failed": 0}
    failures: list[Result] = []
    print_lock = threading.Lock()

    def work(song: Song) -> Result:
        return download_song(
            song,
            root,
            yt_dlp=yt_dlp,
            max_duration=args.max_duration,
            timeout=args.timeout,
            extra_args=extra_args,
        )

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(work, song): song for song in songs}
        for index, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            counts[result.status] += 1
            if result.status == "failed":
                failures.append(result)
            with print_lock:
                tag = {"downloaded": "ok  ", "skipped": "skip", "failed": "FAIL"}[
                    result.status
                ]
                where = result.path.relative_to(root) if result.path else result.detail
                print(f"[{index}/{len(songs)}] {tag} {result.song.label()}  {where}")

    elapsed = time.perf_counter() - started
    print(
        f"\nDone in {elapsed:.0f}s: downloaded={counts['downloaded']} "
        f"skipped={counts['skipped']} failed={counts['failed']}"
    )
    if failures:
        print("\nFailed (re-run to retry; existing files are skipped):", file=sys.stderr)
        for result in failures:
            print(f"  {result.song.label()}: {result.detail}", file=sys.stderr)
        if any("not a bot" in r.detail for r in failures):
            print(
                "\nYouTube asked for a sign-in check. Re-run with "
                "--cookies-from-browser chrome (or firefox/edge) from a machine "
                "where you are logged in to YouTube.",
                file=sys.stderr,
            )
        return 1
    print(f"\nNext: stemsplit {root} -o stems --recursive")
    return 0


def _quote(part: str) -> str:
    return f'"{part}"' if " " in part or "&" in part or "'" in part else part


def main() -> None:
    sys.exit(run())
