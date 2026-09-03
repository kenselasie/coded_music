from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from stemsplit import STEM_NAMES, __version__
from stemsplit.discover import already_complete, discover_tracks, stem_paths
from stemsplit.hardware import format_report, inspect_hardware
from stemsplit.pipeline import (
    FOUR_STEM_MODEL,
    MODEL_CHANNELS,
    MODEL_SAMPLERATE,
    SIX_STEM_MODEL,
    CudaOOMError,
    SeparatorPool,
    load_track,
    save_stems,
    separate_track_wav,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stemsplit",
        description=(
            "Separate a folder of songs into vocals, drums, bass, guitar, piano, "
            "and other using Demucs on a CUDA GPU."
        ),
    )
    parser.add_argument(
        "input",
        nargs="?",
        type=Path,
        help="Folder of songs. Not required with --check-hardware.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("stems"),
        help="Output folder (default: ./stems).",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Walk subfolders of the input directory.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-separate tracks that already have all six stems.",
    )
    parser.add_argument(
        "--cpu",
        action="store_true",
        help="Allow CPU if no GPU is present. Slow; not the design target.",
    )
    parser.add_argument(
        "--quality",
        choices=("standard", "max"),
        default="standard",
        help=(
            "standard: htdemucs_ft then htdemucs_6s on other (default). "
            "max: average htdemucs_ft with mdx_extra, then the same second pass."
        ),
    )
    parser.add_argument(
        "--shifts",
        type=int,
        default=None,
        help="Averaged time-shift passes. Default 5 (standard) or 10 (max).",
    )
    parser.add_argument(
        "--overlap",
        type=float,
        default=0.25,
        help="Segment overlap (default 0.25).",
    )
    parser.add_argument(
        "--segment",
        type=int,
        default=None,
        help="Chunk length in seconds. Hybrid Transformer models cap near 7.8s.",
    )
    parser.add_argument(
        "--keep-models",
        action="store_true",
        help="Keep models in VRAM between tracks (A30/H100).",
    )
    parser.add_argument(
        "--float32",
        action="store_true",
        help="Write 32-bit float WAVs instead of 16-bit.",
    )
    parser.add_argument(
        "--check-hardware",
        action="store_true",
        help="Print GPU/VRAM info and a quality recommendation, then exit.",
    )
    parser.add_argument("--version", action="version", version=f"stemsplit {__version__}")
    return parser


def resolve_device(allow_cpu: bool) -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if allow_cpu:
        print("CUDA is not available; using CPU.", file=sys.stderr)
        return "cpu"
    print(
        "No CUDA GPU found. Install a CUDA PyTorch build, or pass --cpu to run slowly.",
        file=sys.stderr,
    )
    sys.exit(2)


def default_shifts(quality: str, explicit: int | None) -> int:
    if explicit is not None:
        if explicit < 0:
            raise ValueError("--shifts must be >= 0")
        return explicit
    return 10 if quality == "max" else 5


def run(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.check_hardware:
        print(format_report(inspect_hardware()))
        return 0

    if args.input is None:
        parser.error("the input folder is required unless you pass --check-hardware")

    try:
        shifts = default_shifts(args.quality, args.shifts)
    except ValueError as exc:
        parser.error(str(exc))

    device = resolve_device(args.cpu)
    input_dir = args.input.expanduser().resolve()
    try:
        tracks = discover_tracks(input_dir, recursive=args.recursive)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 2
    if not tracks:
        print(f"No audio files found in {args.input}", file=sys.stderr)
        return 1

    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    ensemble = args.quality == "max"

    print(f"Device: {device}")
    print(f"Quality: {args.quality} (ensemble={ensemble})")
    print(f"Models: {FOUR_STEM_MODEL}" + (f" + mdx_extra" if ensemble else "") + f" -> {SIX_STEM_MODEL}")
    print(f"Shifts: {shifts}  overlap: {args.overlap}  segment: {args.segment or 'model default'}")
    print(f"Tracks: {len(tracks)}")
    print(f"Output: {output}")
    print(f"Stems: {', '.join(STEM_NAMES)}")

    pool = SeparatorPool(
        device=device,
        shifts=shifts,
        overlap=args.overlap,
        segment=args.segment,
        keep_models=args.keep_models,
    )
    samplerate = MODEL_SAMPLERATE
    channels = MODEL_CHANNELS

    failed = 0
    skipped = 0
    done = 0
    for index, track in enumerate(tracks, start=1):
        dest = stem_paths(output, track, input_dir)
        print(f"\n[{index}/{len(tracks)}] {track.relative_to(input_dir)}")
        if already_complete(output, track, input_dir) and not args.overwrite:
            print("  skip (stems already exist; pass --overwrite to redo)")
            skipped += 1
            continue

        started = time.perf_counter()
        try:
            wav = load_track(track, samplerate, channels)
            stems, out_rate = separate_track_wav(
                pool, wav, samplerate, ensemble=ensemble
            )
            save_stems(stems, dest, out_rate, float32=args.float32)
        except CudaOOMError as exc:
            print(f"  error: {exc}", file=sys.stderr)
            failed += 1
            continue
        except Exception as exc:  # noqa: BLE001 — per-track isolation
            print(f"  error: {exc}", file=sys.stderr)
            failed += 1
            continue

        elapsed = time.perf_counter() - started
        print(f"  wrote {dest['vocals'].parent} ({elapsed:.1f}s)")
        done += 1

    print(f"\nFinished. separated={done} skipped={skipped} failed={failed}")
    return 1 if failed else 0


def main() -> None:
    sys.exit(run())
