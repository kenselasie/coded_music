# Stemsplit

Folder-in, stems-out. The script walks a directory of songs and writes six WAV stems per track using [Demucs](https://github.com/facebookresearch/demucs) on an NVIDIA GPU.

Stems: **vocals, drums, bass, guitar, piano, other**.

Two commands:

| Command | Job |
| --- | --- |
| `stemsplit-download` | Pull a curated 100-song catalog from YouTube with yt-dlp into `songs/<genre>/<artist>/` |
| `stemsplit` | Separate every song in a folder into stems |

```bash
stemsplit-download -o songs
stemsplit songs -o stems --recursive
```

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

`pip install -e .` also installs `yt-dlp` and `pyyaml` for the downloader.

FFmpeg is required by both commands (yt-dlp audio extraction, Demucs decoding):

```bash
# Debian/Ubuntu
sudo apt install ffmpeg
```

The first run downloads Demucs weights (hundreds of MB to a few GB depending on `--quality`).

## Downloading the catalog

`stemsplit-download` reads `stemsplit/catalog.yaml` (genre → artist → titles), searches YouTube for `"<artist> <title> official audio"`, and saves the best audio stream without re-encoding (`.opus`, `.m4a`, or `.mp3` depending on the upload). Results longer than 12 minutes or live streams are skipped so you get songs, not full albums.

The built-in catalog is 100 songs:

- **gospel** — Team Eternity Ghana, William McDowell, Joe Mettle, Sinach, Nathaniel Bassey
- **afrobeats** — Stonebwoy, Shatta Wale, Burna Boy, Wizkid, Davido, Sarkodie, King Promise, KiDi
- **rnb-pop** — Michael Jackson, Bruno Mars, Usher, Alicia Keys, The Weeknd, Whitney Houston, John Legend, Beyoncé

```bash
stemsplit-download --list                         # show what will be fetched
stemsplit-download -o songs                       # all 100
stemsplit-download -o songs --genre gospel        # one genre
stemsplit-download -o songs --artist "Bruno Mars" --limit 3
stemsplit-download -o songs --catalog my-songs.yaml
```

Layout:

```
songs/
  gospel/
    team-eternity-ghana/
      defe-defe.opus
    william-mcdowell/
      i-give-myself-away.m4a
  afrobeats/
    stonebwoy/
      putuu.opus
  rnb-pop/
    bruno-mars/
      uptown-funk.opus
```

Existing files are skipped, so re-running only fetches what failed. Downloads run 3 at a time (`--workers`).

If YouTube answers **"Sign in to confirm you're not a bot"** (common on cloud/datacenter IPs), pass your browser's cookies from a machine where you are logged in:

```bash
stemsplit-download -o songs --cookies-from-browser chrome     # or firefox, edge, brave
stemsplit-download -o songs --cookies ~/youtube-cookies.txt   # exported cookies.txt
```

Edit the catalog by adding titles under an artist, or artists under a genre. Titles become folder-safe slugs automatically. Downloading is for material you have the right to use; the tool does not bypass any access controls.

## Separating

Point `stemsplit` at any folder of audio (wav, flac, mp3, m4a, opus, ogg, aiff, …). With `--recursive`, the input's folder structure is mirrored into the output.

```bash
stemsplit ./songs -o ./stems --recursive
```

Output layout:

```
stems/
  gospel/
    team-eternity-ghana/
      defe-defe/
        vocals.wav
        drums.wav
        bass.wav
        guitar.wav
        piano.wav
        other.wav
```

Without `--recursive` (a flat folder of songs) the layout is `stems/<track-name>/…`.

Useful flags:

```bash
stemsplit ./songs -o ./stems --recursive
stemsplit ./songs -o ./stems --quality max --keep-models
stemsplit ./songs -o ./stems --shifts 10 --float32
stemsplit ./songs -o ./stems --overwrite
stemsplit ./songs -o ./stems --cpu          # last resort
```

Tracks that already have all six stem files are skipped unless you pass `--overwrite`.

When a run finishes, the CLI prints how to open the viewer.

## CodedMusic (web UI)

**CodedMusic** is the Next.js app in `web/`, built with [CodedDesign](https://github.com/kenselasie/coded_design) (`@kenselasie/codeddesign` ^0.1.4). It is multi-tenant: each account has its own library and jobs in **Postgres** (Drizzle ORM + Auth.js).

Pages:

- **Library** (`/`) — your songs; open ready tracks or process queued ones  
- **Add song** (`/add`) — paste a YouTube link; save for later or split now  
- **Processing** (`/processing`) — live job steps and recent runs  
- **Sign in / Sign up** — email + password accounts  

Chord progression from piano and other stems is coming soon. Stem WAV files are stored on local disk under `stems/<userId>/…` for now (S3 later).

**Local processing:** Demucs runs on the machine that hosts the app/worker (your PC when you `npm run dev`), not in the browser. You can upload a local audio file or paste a YouTube link; both end up as stem jobs executed with the local Python env / GPU.

```bash
# 1) Postgres
docker compose up -d

# 2) Python worker deps (includes psycopg)
pip install -e .

# 3) Web app
cd web
cp .env.example .env.local   # set AUTH_SECRET to a long random string
npm install
npm run db:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, then add a song.

Env vars (see `web/.env.example`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres (Compose maps host **5434** → container 5432) |
| `AUTH_SECRET` | Auth.js session secret |
| `STEMSPLIT_OUTPUT` | Root for stem files (app appends `<userId>/`) |
| `STEMSPLIT_PYTHON` | Python for the YouTube worker |
| `STEMSPLIT_CPU=1` | Run Demucs on CPU |
| `STEMSPLIT_COOKIES_FROM_BROWSER` | yt-dlp browser cookies if YouTube blocks |

The library refreshes every few seconds while a split is running.

## How a song is processed

One track at a time (VRAM). Models unload between stages unless `--keep-models` is set. Runtime on an A30 at `--quality max --shifts 10` is typically several minutes per song, not seconds.

## Tests

```bash
pip install -e ".[dev]"
pytest
```

Tests cover file discovery, stem merging, hardware hints, catalog parsing, and yt-dlp command construction. They do not hit YouTube, download weights, or run the networks.
