from pathlib import Path

import pytest

from stemsplit.download import (
    Song,
    build_command,
    default_catalog_text,
    existing_download,
    filter_songs,
    parse_catalog,
    resolve_yt_dlp,
    slugify,
)


def test_resolve_yt_dlp_falls_back_to_module() -> None:
    cmd = resolve_yt_dlp("definitely-not-a-real-binary-name")
    assert cmd is not None and cmd[-2:] == ["-m", "yt_dlp"]


def test_slugify() -> None:
    assert slugify("Beyoncé") == "beyonce"
    assert slugify("That's What I Like") == "that-s-what-i-like"
    assert slugify("Kpo K3k3") == "kpo-k3k3"
    assert slugify("  ") == "untitled"


def test_builtin_catalog_has_about_100_songs() -> None:
    songs = parse_catalog(default_catalog_text())
    assert 95 <= len(songs) <= 110
    genres = {slugify(s.genre) for s in songs}
    assert genres == {"gospel", "afrobeats", "rnb-pop"}
    artists = {s.artist for s in songs}
    for name in (
        "Team Eternity Ghana",
        "William McDowell",
        "Stonebwoy",
        "Shatta Wale",
        "Michael Jackson",
        "Bruno Mars",
    ):
        assert name in artists


def test_parse_catalog_rejects_duplicates() -> None:
    text = """
genres:
  pop:
    Artist:
      - Song
      - song
"""
    with pytest.raises(ValueError, match="duplicate"):
        parse_catalog(text)


def test_parse_catalog_rejects_bad_shape() -> None:
    with pytest.raises(ValueError):
        parse_catalog("genres: []")
    with pytest.raises(ValueError):
        parse_catalog("genres:\n  pop:\n    Artist: not-a-list\n")


def test_filter_songs() -> None:
    songs = [
        Song("gospel", "Sinach", "Way Maker"),
        Song("afrobeats", "Stonebwoy", "Putuu"),
        Song("rnb-pop", "Bruno Mars", "Grenade"),
    ]
    assert [s.title for s in filter_songs(songs, genres=["Gospel"], artists=None, limit=None)] == [
        "Way Maker"
    ]
    assert [s.title for s in filter_songs(songs, genres=None, artists=["bruno mars"], limit=None)] == [
        "Grenade"
    ]
    assert len(filter_songs(songs, genres=None, artists=None, limit=2)) == 2


def test_target_layout_and_command(tmp_path: Path) -> None:
    song = Song("rnb-pop", "Bruno Mars", "Uptown Funk")
    assert song.target_dir(tmp_path) == tmp_path / "rnb-pop" / "bruno-mars"
    cmd = build_command(song, tmp_path, yt_dlp=["python", "-m", "yt_dlp"], max_duration=600)
    assert cmd[:3] == ["python", "-m", "yt_dlp"]
    assert cmd[3] == "ytsearch5:Bruno Mars Uptown Funk official audio"
    assert "--extract-audio" in cmd
    assert "--max-downloads" in cmd
    assert str(tmp_path / "rnb-pop" / "bruno-mars" / "uptown-funk.%(ext)s") in cmd
    assert "duration<600 & !is_live" in cmd

    with_cookies = build_command(
        song,
        tmp_path,
        yt_dlp=["yt-dlp"],
        max_duration=600,
        extra_args=["--cookies-from-browser", "chrome"],
    )
    assert with_cookies[1:3] == ["--cookies-from-browser", "chrome"]


def test_existing_download(tmp_path: Path) -> None:
    folder = tmp_path / "gospel" / "sinach"
    folder.mkdir(parents=True)
    assert existing_download(folder, "way-maker") is None
    (folder / "way-maker.part").write_bytes(b"partial")
    assert existing_download(folder, "way-maker") is None
    (folder / "way-maker.opus").write_bytes(b"audio")
    assert existing_download(folder, "way-maker") == folder / "way-maker.opus"
