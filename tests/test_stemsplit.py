from pathlib import Path

import torch

from stemsplit.discover import already_complete, discover_tracks, stem_paths
from stemsplit.stems import average_stems, merge_six_stems


def test_discover_missing_folder(tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    try:
        discover_tracks(missing)
    except FileNotFoundError as exc:
        assert "nope" in str(exc)
    else:
        raise AssertionError("expected FileNotFoundError")


def test_discover_top_level_only(tmp_path: Path) -> None:
    (tmp_path / "a.wav").write_bytes(b"x")
    nested = tmp_path / "album"
    nested.mkdir()
    (nested / "b.mp3").write_bytes(b"x")
    (tmp_path / "notes.txt").write_text("nope")

    found = discover_tracks(tmp_path, recursive=False)
    assert [p.name for p in found] == ["a.wav"]

    found = discover_tracks(tmp_path, recursive=True)
    assert [p.name for p in found] == ["a.wav", "b.mp3"]


def test_already_complete(tmp_path: Path) -> None:
    track = Path("song.flac")
    assert not already_complete(tmp_path, track)
    for path in stem_paths(tmp_path, track).values():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"stem")
    assert already_complete(tmp_path, track)


def test_average_stems() -> None:
    ones = {name: torch.ones(2, 8) for name in ("vocals", "drums", "bass", "other")}
    zeros = {name: torch.zeros(2, 10) for name in ones}
    out = average_stems(ones, zeros)
    assert out["vocals"].shape[-1] == 8
    assert torch.allclose(out["vocals"], torch.full((2, 8), 0.5))


def test_merge_six_stems_keeps_first_pass_core() -> None:
    four = {
        "vocals": torch.ones(2, 6),
        "drums": torch.full((2, 6), 2),
        "bass": torch.full((2, 6), 3),
        "other": torch.full((2, 6), 4),
    }
    six = {
        "vocals": torch.zeros(2, 6),
        "drums": torch.zeros(2, 6),
        "bass": torch.zeros(2, 6),
        "other": torch.full((2, 6), 0.5),
        "guitar": torch.full((2, 6), 7),
        "piano": torch.full((2, 6), 8),
    }
    merged = merge_six_stems(four, six)
    assert torch.equal(merged["vocals"], four["vocals"])
    assert torch.equal(merged["drums"], four["drums"])
    assert torch.equal(merged["bass"], four["bass"])
    assert torch.equal(merged["guitar"], six["guitar"])
    assert torch.equal(merged["piano"], six["piano"])
    # leftover 6-stem energy (not guitar/piano) becomes other
    assert torch.allclose(merged["other"], torch.full((2, 6), 0.5))


def test_merge_requires_guitar_piano() -> None:
    four = {
        "vocals": torch.ones(2, 4),
        "drums": torch.ones(2, 4),
        "bass": torch.ones(2, 4),
        "other": torch.ones(2, 4),
    }
    six = {name: torch.ones(2, 4) for name in ("vocals", "drums", "bass", "other")}
    try:
        merge_six_stems(four, six)
    except KeyError as exc:
        assert "guitar" in str(exc)
    else:
        raise AssertionError("expected KeyError")
