from __future__ import annotations

import torch

CORE_STEMS = ("vocals", "drums", "bass", "other")
SIX_STEM_EXTRA = ("guitar", "piano")


def _match_length(left: torch.Tensor, right: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    length = min(left.shape[-1], right.shape[-1])
    return left[..., :length], right[..., :length]


def average_stems(
    first: dict[str, torch.Tensor],
    second: dict[str, torch.Tensor],
    keys: tuple[str, ...] = CORE_STEMS,
) -> dict[str, torch.Tensor]:
    """Mean two 4-stem estimates. Missing keys raise KeyError."""
    averaged: dict[str, torch.Tensor] = {}
    for key in keys:
        a, b = _match_length(first[key], second[key])
        averaged[key] = (a + b) / 2
    return averaged


def guitar_piano_from_six(
    first_other: torch.Tensor,
    six_stems: dict[str, torch.Tensor],
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Keep guitar/piano from the 6-stem pass; fold leftover energy into other."""
    if "guitar" not in six_stems or "piano" not in six_stems:
        raise KeyError(
            "6-stem model did not return guitar and piano. "
            f"Got: {sorted(six_stems)}"
        )
    guitar = six_stems["guitar"]
    piano = six_stems["piano"]
    leftover = [
        waveform
        for name, waveform in six_stems.items()
        if name not in SIX_STEM_EXTRA
    ]
    if leftover:
        residual = leftover[0]
        for extra in leftover[1:]:
            residual = residual + extra
    else:
        residual = torch.zeros_like(guitar)

    guitar, piano = _match_length(guitar, piano)
    guitar, residual = _match_length(guitar, residual)
    piano, residual = _match_length(piano, residual)
    first_other, residual = _match_length(first_other, residual)
    # Prefer the 6-stem residual when it exists; it already accounts for
    # energy the second model did not assign to guitar/piano.
    other = residual
    other, guitar = _match_length(other, guitar)
    other, piano = _match_length(other, piano)
    return guitar, piano, other


def merge_six_stems(
    four: dict[str, torch.Tensor],
    six_from_other: dict[str, torch.Tensor],
) -> dict[str, torch.Tensor]:
    guitar, piano, other = guitar_piano_from_six(four["other"], six_from_other)
    vocals, drums, bass = four["vocals"], four["drums"], four["bass"]
    vocals, guitar = _match_length(vocals, guitar)
    drums, guitar = _match_length(drums, guitar)
    bass, guitar = _match_length(bass, guitar)
    return {
        "vocals": vocals,
        "drums": drums,
        "bass": bass,
        "guitar": guitar,
        "piano": piano,
        "other": other,
    }
