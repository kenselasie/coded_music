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


def track_folder(output_dir: Path, track: Path, input_dir: Path | None = None) -> Path:
    """Mirror the track's folder under output_dir so songs/<genre>/<artist>/x.mp3
    becomes stems/<genre>/<artist>/x/."""
    if input_dir is not None:
        try:
            relative_parent = track.parent.relative_to(input_dir)
        except ValueError:
            relative_parent = Path()
        return output_dir / relative_parent / track.stem
    return output_dir / track.stem


def stem_paths(
    output_dir: Path, track: Path, input_dir: Path | None = None
) -> dict[str, Path]:
    folder = track_folder(output_dir, track, input_dir)
    return {name: folder / f"{name}.wav" for name in STEM_NAMES}


def already_complete(
    output_dir: Path, track: Path, input_dir: Path | None = None
) -> bool:
    paths = stem_paths(output_dir, track, input_dir)
    return all(path.is_file() and path.stat().st_size > 0 for path in paths.values())
