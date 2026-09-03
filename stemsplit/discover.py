from __future__ import annotations

from pathlib import Path

from stemsplit import AUDIO_SUFFIXES, STEM_NAMES


def discover_tracks(input_dir: Path, *, recursive: bool = False) -> list[Path]:
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input folder does not exist: {input_dir}")

    iterator = input_dir.rglob("*") if recursive else input_dir.iterdir()
    tracks = [
        path
        for path in iterator
        if path.is_file() and path.suffix.lower() in AUDIO_SUFFIXES
    ]
    return sorted(tracks)


def stem_paths(output_dir: Path, track: Path) -> dict[str, Path]:
    folder = output_dir / track.stem
    return {name: folder / f"{name}.wav" for name in STEM_NAMES}


def already_complete(output_dir: Path, track: Path) -> bool:
    paths = stem_paths(output_dir, track)
    return all(path.is_file() and path.stat().st_size > 0 for path in paths.values())
