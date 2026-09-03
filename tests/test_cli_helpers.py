from stemsplit.cli import default_shifts
from stemsplit.hardware import _recommend
from stemsplit.pipeline import is_cuda_oom


def test_quality_shift_defaults() -> None:
    assert default_shifts("standard", None) == 5
    assert default_shifts("max", None) == 10
    assert default_shifts("max", 2) == 2


def test_hardware_hints() -> None:
    assert "No NVIDIA" in _recommend(False, None)
    assert "Skip --quality max" in _recommend(True, 8.0)
    assert "A30/H100" in _recommend(True, 24.0)


def test_oom_detection() -> None:
    assert is_cuda_oom(RuntimeError("CUDA out of memory"))
    assert not is_cuda_oom(RuntimeError("file not found"))
