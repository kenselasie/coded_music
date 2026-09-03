# Stemsplit

Folder-in, stems-out. The script walks a directory of songs and writes six WAV stems per track using [Demucs](https://github.com/facebookresearch/demucs) on an NVIDIA GPU.

Stems: **vocals, drums, bass, guitar, piano, other**.

## Hardware

You need an **NVIDIA GPU with a CUDA build of PyTorch**. AMD/Intel GPUs are not the target.

| VRAM | What to run |
| --- | --- |
| 8 GB | `--quality standard --shifts 5`. If you OOM, pass `--segment 7`. |
| 12 GB | Standard quality comfortably; `--quality max` one song at a time. |
| 24 GB (A30) | `--quality max --shifts 10 --keep-models` |
| 80 GB (H100) | Same quality as A30, faster folder throughput with `--keep-models` |

Also plan for **16 GB system RAM**, **FFmpeg** on your PATH, and disk for WAVs (six stems ≈ 6× the uncompressed mix).

CPU works with `--cpu` but a 4-minute song can take many minutes. This project is built for CUDA.

Check what the machine actually sees:

```bash
stemsplit --check-hardware
```

## Quality modes

**standard (default)** — two-pass:

1. `htdemucs_ft` on the mix → vocals, drums, bass, other  
2. `htdemucs_6s` on that **other** stem → guitar, piano, leftover other  

`--shifts` defaults to **5**. First-pass vocals/drums/bass are kept from the fine-tuned 4-stem model (better than 6-stem on a full mix). Guitar and piano come from the second pass.

**max** — same second pass, but the 4-stem estimate is an ensemble:

1. `htdemucs_ft` and `mdx_extra` on the mix, then average  
2. `htdemucs_6s` on the averaged other  

`--shifts` defaults to **10**. This is the quality ceiling in this repo. Piano is still the weakest stem; no open model fully solves it.

`--shifts N` runs N random time-shifts and averages them. It multiplies runtime, not VRAM. Returns flatten after about 10.

On CUDA out-of-memory the script **stops that track** and tells you to set `--segment 7`. It will not silently drop shifts or switch models.

## Install

Use Python 3.10+. Create a venv, then install a **CUDA** PyTorch from [pytorch.org](https://pytorch.org/get-started/locally/) to match your driver. Example for CUDA 12.4:

```bash
python -m venv .venv
source .venv/bin/activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -e .
```

CPU-only PyTorch is enough to run `--check-hardware` and `--help`. Real separation should use CUDA.

FFmpeg is required for mp3/m4a/flac and most compressed inputs:

```bash
# Debian/Ubuntu
sudo apt install ffmpeg
```

The first run downloads Demucs weights (hundreds of MB to a few GB depending on `--quality`).

## Usage

Put songs in a folder (wav, flac, mp3, m4a, ogg, aiff, …).

```bash
stemsplit ./songs -o ./stems
```

Output layout:

```
stems/
  track-name/
    vocals.wav
    drums.wav
    bass.wav
    guitar.wav
    piano.wav
    other.wav
```

Useful flags:

```bash
stemsplit ./songs -o ./stems --recursive
stemsplit ./songs -o ./stems --quality max --keep-models
stemsplit ./songs -o ./stems --shifts 10 --float32
stemsplit ./songs -o ./stems --overwrite
stemsplit ./songs -o ./stems --cpu          # last resort
```

Tracks that already have all six stem files are skipped unless you pass `--overwrite`.

## How a song is processed

One track at a time (VRAM). Models unload between stages unless `--keep-models` is set. Runtime on an A30 at `--quality max --shifts 10` is typically several minutes per song, not seconds.

## Tests

```bash
pip install -e ".[dev]"
pytest
```

Tests cover file discovery, stem merging, and hardware hints. They do not download weights or run the networks.
