from __future__ import annotations

from pathlib import Path

import torch

from stemsplit.stems import CORE_STEMS, average_stems, merge_six_stems

FOUR_STEM_MODEL = "htdemucs_ft"
ENSEMBLE_MODEL = "mdx_extra"
SIX_STEM_MODEL = "htdemucs_6s"
MODEL_SAMPLERATE = 44100
MODEL_CHANNELS = 2


class CudaOOMError(RuntimeError):
    """Raised when Demucs runs out of GPU memory. Callers must not retry with silent quality drops."""


def is_cuda_oom(exc: BaseException) -> bool:
    message = str(exc).lower()
    return isinstance(exc, RuntimeError) and (
        "out of memory" in message or "cuda oom" in message
    )


class SeparatorPool:
    """Load Demucs separators on demand. Optionally keep them resident for big GPUs."""

    def __init__(
        self,
        *,
        device: str,
        shifts: int,
        overlap: float,
        segment: int | None,
        keep_models: bool,
        progress: bool = True,
    ) -> None:
        self.device = device
        self.shifts = shifts
        self.overlap = overlap
        self.segment = segment
        self.keep_models = keep_models
        self.progress = progress
        self._cache: dict[str, object] = {}

    def get(self, name: str):
        if name in self._cache:
            separator = self._cache[name]
            separator.update_parameter(  # type: ignore[attr-defined]
                device=self.device,
                shifts=self.shifts,
                overlap=self.overlap,
                segment=self.segment,
                progress=self.progress,
            )
            return separator

        from demucs.api import Separator

        separator = Separator(
            model=name,
            device=self.device,
            shifts=self.shifts,
            overlap=self.overlap,
            split=True,
            segment=self.segment,
            progress=self.progress,
        )
        if self.keep_models:
            self._cache[name] = separator
        return separator

    def drop(self, separator) -> None:
        if self.keep_models:
            return
        del separator
        if self.device.startswith("cuda") and torch.cuda.is_available():
            torch.cuda.empty_cache()


def separate_tensor(separator, wav: torch.Tensor, sample_rate: int) -> dict[str, torch.Tensor]:
    try:
        _mix, stems = separator.separate_tensor(wav, sample_rate)
    except RuntimeError as exc:
        if is_cuda_oom(exc):
            raise CudaOOMError(
                "GPU ran out of memory. Re-run with --segment 7 (Hybrid Transformer "
                "models cap around 7.8s). Do not lower shifts silently; that is a "
                "quality choice you should make explicitly."
            ) from exc
        raise
    return {key: value.detach().cpu() for key, value in stems.items()}


def separate_four_stem_ensemble(
    pool: SeparatorPool,
    wav: torch.Tensor,
    sample_rate: int,
    *,
    ensemble: bool,
) -> tuple[dict[str, torch.Tensor], int]:
    primary = pool.get(FOUR_STEM_MODEL)
    four = separate_tensor(primary, wav, sample_rate)
    rate = primary.samplerate
    pool.drop(primary)

    if not ensemble:
        return four, rate

    secondary = pool.get(ENSEMBLE_MODEL)
    extra = separate_tensor(secondary, wav, sample_rate)
    pool.drop(secondary)
    return average_stems(four, extra, CORE_STEMS), rate


def split_other_into_guitar_piano(
    pool: SeparatorPool,
    other: torch.Tensor,
    sample_rate: int,
) -> dict[str, torch.Tensor]:
    six = pool.get(SIX_STEM_MODEL)
    stems = separate_tensor(six, other, sample_rate)
    pool.drop(six)
    return stems


def separate_track_wav(
    pool: SeparatorPool,
    wav: torch.Tensor,
    sample_rate: int,
    *,
    ensemble: bool,
) -> tuple[dict[str, torch.Tensor], int]:
    four, rate = separate_four_stem_ensemble(
        pool, wav, sample_rate, ensemble=ensemble
    )
    six = split_other_into_guitar_piano(pool, four["other"], rate)
    return merge_six_stems(four, six), rate


def load_track(path: Path, samplerate: int, channels: int) -> torch.Tensor:
    import subprocess

    import torchaudio as ta
    from demucs.audio import AudioFile, convert_audio

    errors: dict[str, str] = {}
    wav = None
    try:
        wav = AudioFile(path).read(streams=0, samplerate=samplerate, channels=channels)
    except FileNotFoundError:
        errors["ffmpeg"] = "FFmpeg is not installed."
    except subprocess.CalledProcessError:
        errors["ffmpeg"] = "FFmpeg could not read the file."

    if wav is None:
        try:
            wav, sr = ta.load(str(path))
        except RuntimeError as exc:
            errors["torchaudio"] = str(exc)
        else:
            wav = convert_audio(wav, sr, samplerate, channels)

    if wav is None:
        detail = " ".join(f"{k}: {v}" for k, v in errors.items()) or "unknown error"
        raise RuntimeError(f"Could not load {path}: {detail}")
    return wav


def save_stems(
    stems: dict[str, torch.Tensor],
    dest: dict[str, Path],
    samplerate: int,
    *,
    float32: bool,
) -> None:
    from demucs.api import save_audio

    dest_dir = next(iter(dest.values())).parent
    dest_dir.mkdir(parents=True, exist_ok=True)
    kwargs = {
        "samplerate": samplerate,
        "clip": "rescale",
        "as_float": float32,
        "bits_per_sample": 16 if not float32 else 32,
    }
    for name, path in dest.items():
        save_audio(stems[name], str(path), **kwargs)
