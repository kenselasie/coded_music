from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HardwareReport:
    torch_version: str
    cuda_build: bool
    cuda_available: bool
    device_name: str | None
    vram_gb: float | None
    recommendation: str


def inspect_hardware() -> HardwareReport:
    import torch

    cuda_available = torch.cuda.is_available()
    device_name = None
    vram_gb = None
    if cuda_available:
        device_name = torch.cuda.get_device_name(0)
        props = torch.cuda.get_device_properties(0)
        vram_gb = props.total_memory / (1024**3)

    recommendation = _recommend(cuda_available, vram_gb)
    return HardwareReport(
        torch_version=torch.__version__,
        cuda_build=torch.backends.cuda.is_built(),
        cuda_available=cuda_available,
        device_name=device_name,
        vram_gb=vram_gb,
        recommendation=recommendation,
    )


def _recommend(cuda_available: bool, vram_gb: float | None) -> str:
    if not cuda_available:
        return (
            "No NVIDIA CUDA GPU visible. Install a CUDA build of PyTorch, "
            "or pass --cpu (slow, not recommended for a folder of songs)."
        )
    assert vram_gb is not None
    if vram_gb < 6:
        return (
            f"{vram_gb:.1f} GB VRAM is tight. Use --quality standard --shifts 1 "
            "--segment 7. Prefer an 8 GB+ card for this project."
        )
    if vram_gb < 10:
        return (
            f"{vram_gb:.1f} GB VRAM: --quality standard --shifts 5 should work. "
            "If you OOM, set --segment 7. Skip --quality max."
        )
    if vram_gb < 20:
        return (
            f"{vram_gb:.1f} GB VRAM: good for --quality standard --shifts 5, "
            "and --quality max --shifts 10 if you process one song at a time."
        )
    return (
        f"{vram_gb:.1f} GB VRAM (A30/H100 class): use --quality max --shifts 10 "
        "--keep-models. Ensemble + two-pass is the quality ceiling for this script."
    )


def format_report(report: HardwareReport) -> str:
    lines = [
        f"PyTorch {report.torch_version}",
        f"CUDA build: {report.cuda_build}",
        f"CUDA available: {report.cuda_available}",
    ]
    if report.device_name:
        lines.append(f"GPU: {report.device_name}")
    if report.vram_gb is not None:
        lines.append(f"VRAM: {report.vram_gb:.1f} GB")
    lines.append(report.recommendation)
    return "\n".join(lines)
