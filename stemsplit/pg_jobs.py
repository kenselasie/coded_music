"""Postgres helpers for CodedMusic YouTube jobs (stdlib + psycopg)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

STEPS: list[tuple[str, str]] = [
    ("validate", "Checking link"),
    ("metadata", "Reading video info"),
    ("download", "Downloading audio"),
    ("load", "Loading audio"),
    ("four_stem", "Separating vocals, drums, bass"),
    ("six_stem", "Separating guitar and piano"),
    ("save", "Writing stem files"),
    ("done", "Ready"),
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def connect(database_url: str):
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "psycopg is required for database-backed jobs. "
            'Install with: pip install "psycopg[binary]"'
        ) from exc
    return psycopg.connect(database_url)


def load_job(conn, job_id: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, track_id, url, audio_path, status, step, step_key, steps,
                   title, artist, href, error, detail, pid, updated_at
            FROM jobs
            WHERE id = %s
            """,
            (job_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    steps = row[8]
    if isinstance(steps, str):
        steps = json.loads(steps)
    return {
        "id": str(row[0]),
        "userId": str(row[1]),
        "trackId": str(row[2]) if row[2] else None,
        "url": row[3] or "",
        "audioPath": row[4],
        "status": row[5],
        "step": row[6],
        "stepKey": row[7],
        "steps": steps,
        "title": row[9],
        "artist": row[10],
        "href": row[11],
        "error": row[12],
        "detail": row[13],
        "pid": row[14],
        "updatedAt": row[15],
    }


def write_job_row(conn, job: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs
            SET track_id = %s,
                url = %s,
                audio_path = %s,
                status = %s,
                step = %s,
                step_key = %s,
                steps = %s::jsonb,
                title = %s,
                artist = %s,
                href = %s,
                error = %s,
                detail = %s,
                pid = %s,
                updated_at = %s
            WHERE id = %s
            """,
            (
                job.get("trackId"),
                job.get("url") or "",
                job.get("audioPath"),
                job["status"],
                job["step"],
                job["stepKey"],
                json.dumps(job["steps"]),
                job.get("title"),
                job.get("artist"),
                job.get("href"),
                job.get("error"),
                job.get("detail"),
                job.get("pid"),
                utc_now(),
                job["id"],
            ),
        )
    conn.commit()


def set_track_status(
    conn,
    *,
    user_id: str,
    track_id: str | None,
    slug: str | None,
    status: str,
    title: str | None = None,
    artist: str | None = None,
    url: str | None = None,
    error: str | None = None,
    storage_prefix: str | None = None,
) -> str | None:
    """Update or insert a track; returns track id."""
    with conn.cursor() as cur:
        if track_id:
            cur.execute(
                """
                UPDATE tracks
                SET status = %s,
                    error = %s,
                    title = COALESCE(%s, title),
                    artist = COALESCE(%s, artist),
                    url = COALESCE(%s, url),
                    storage_prefix = COALESCE(%s, storage_prefix),
                    updated_at = %s
                WHERE id = %s AND user_id = %s
                RETURNING id
                """,
                (
                    status,
                    error,
                    title,
                    artist,
                    url,
                    storage_prefix,
                    utc_now(),
                    track_id,
                    user_id,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return str(row[0]) if row else None

        if not slug:
            conn.commit()
            return None

        cur.execute(
            """
            INSERT INTO tracks (
              user_id, slug, title, artist, url, source, status, error,
              storage_prefix, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, 'youtube', %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, slug) DO UPDATE SET
              status = EXCLUDED.status,
              error = EXCLUDED.error,
              title = EXCLUDED.title,
              artist = EXCLUDED.artist,
              url = COALESCE(EXCLUDED.url, tracks.url),
              storage_prefix = EXCLUDED.storage_prefix,
              updated_at = EXCLUDED.updated_at
            RETURNING id
            """,
            (
                user_id,
                slug,
                title or "YouTube track",
                artist or "YouTube",
                url,
                status,
                error,
                storage_prefix or f"{user_id}/{slug}",
                utc_now(),
                utc_now(),
            ),
        )
        row = cur.fetchone()
    conn.commit()
    return str(row[0]) if row else None


def release_user_lock(conn, user_id: str, job_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM user_locks WHERE user_id = %s AND job_id = %s",
            (user_id, job_id),
        )
    conn.commit()


def ensure_uuid(value: str) -> str:
    return str(UUID(value))
