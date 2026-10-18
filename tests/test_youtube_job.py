from pathlib import Path

from stemsplit.youtube_job import (
    STEPS,
    fail_job,
    initial_job,
    is_youtube_url,
    set_step,
    video_id,
    write_job,
)


def test_is_youtube_url_accepts_common_forms():
    assert is_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert is_youtube_url("https://youtu.be/dQw4w9WgXcQ")
    assert is_youtube_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ")
    assert is_youtube_url("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    assert not is_youtube_url("https://example.com/watch?v=dQw4w9WgXcQ")
    assert not is_youtube_url("not a url")


def test_video_id_extracts_id():
    assert video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert video_id("https://www.youtube.com/shorts/abc123XYZ01") == "abc123XYZ01"


def test_job_step_progress_roundtrip(tmp_path: Path):
    job = initial_job("abc", "https://youtu.be/dQw4w9WgXcQ")
    assert len(job["steps"]) == len(STEPS)
    assert job["status"] == "queued"

    set_step(job, "download", detail="Example Song")
    assert job["status"] == "running"
    assert job["stepKey"] == "download"
    assert job["steps"][0]["status"] == "done"
    assert job["steps"][2]["status"] == "active"
    assert job["detail"] == "Example Song"

    path = tmp_path / "abc.json"
    write_job(path, job)
    loaded = path.read_text(encoding="utf-8")
    assert '"download"' in loaded

    fail_job(job, "boom")
    assert job["status"] == "failed"
    assert job["error"] == "boom"
    assert job["steps"][2]["status"] == "error"
