"use client";

import {
  Button,
  SearchInput,
  SectionMessage,
} from "@kenselasie/codeddesign";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { Library, TrackSummary } from "@/lib/types";

function statusMeta(track: TrackSummary) {
  if (track.status === "ready" || track.present === track.stems.length) {
    return { tone: "ready" as const, label: "Ready" };
  }
  if (track.status === "processing") {
    return { tone: "processing" as const, label: "Processing" };
  }
  if (track.status === "failed") {
    return { tone: "failed" as const, label: "Failed" };
  }
  return { tone: "queued" as const, label: "Queued" };
}

function formatCreated(value: string | null) {
  if (!value) return "—";
  const date = new Date(value.replace(" UTC", "Z").replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function WaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 10h2v8H4v-8Zm4-4h2v12H8V6Zm4 2h2v10h-2V8Zm4-3h2v13h-2V5Zm4 5h2v8h-2v-8Z"
      />
    </svg>
  );
}

export function TrackLibrary({ library }: { library: Library }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [processError, setProcessError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [router]);

  const tracks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.tracks.filter((track) => {
      if (filter === "ready" && track.status !== "ready" && track.present < 6) {
        return false;
      }
      if (filter === "queued" && track.status !== "queued" && track.status !== "failed") {
        return false;
      }
      if (filter === "processing" && track.status !== "processing") return false;
      if (!needle) return true;
      return `${track.title} ${track.group}`.toLowerCase().includes(needle);
    });
  }, [filter, library.tracks, query]);

  const readyCount = library.tracks.filter(
    (track) => track.status === "ready" || track.present === 6,
  ).length;
  const queuedCount = library.tracks.filter(
    (track) => track.status === "queued" || track.status === "failed",
  ).length;
  const processingCount = library.tracks.filter(
    (track) => track.status === "processing",
  ).length;

  const processTrack = async (trackId: string) => {
    setProcessError(null);
    setProcessingId(trackId);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setProcessError(data.error ?? "Could not start processing.");
        return;
      }
      router.push("/processing");
      router.refresh();
    } catch {
      setProcessError("Could not reach the server.");
    } finally {
      setProcessingId(null);
    }
  };

  const fileLabel =
    library.tracks.length === 1 ? "1 song" : `${library.tracks.length} songs`;

  return (
    <div>
      <header className="page-header">
        <div className="page-header-title">
          <h1>Library</h1>
          <span className="page-header-count">{fileLabel}</span>
        </div>
        <div className="page-header-tools">
          <div className="page-search">
            <SearchInput
              label="Search"
              hideLabel
              value={query}
              onChange={setQuery}
              placeholder="Search songs"
            />
          </div>
          <Link href="/add" className="page-cta">
            <span aria-hidden="true">+</span>
            Add
          </Link>
        </div>
      </header>

      {processError ? (
        <div style={{ marginBottom: 16 }}>
          <SectionMessage variant="danger" title="Could not process">
            {processError}
          </SectionMessage>
        </div>
      ) : null}

      <section className="library-panel">
        <div className="library-toolbar">
          <div className="library-filters" role="group" aria-label="Filter songs">
            {(
              [
                ["all", `All ${library.tracks.length}`],
                ["ready", `Ready ${readyCount}`],
                ["queued", `Queued ${queuedCount}`],
                ["processing", `Processing ${processingCount}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="library-filter"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="small" onClick={() => router.refresh()}>
            Refresh
          </Button>
        </div>

        {library.tracks.length === 0 ? (
          <div className="library-empty">
            <h2>No songs yet</h2>
            <p>Add a YouTube link, then process stems when you are ready.</p>
            <Link href="/add" className="page-cta">
              <span aria-hidden="true">+</span>
              Add song
            </Link>
          </div>
        ) : tracks.length === 0 ? (
          <div className="library-empty">
            <h2>Nothing matches</h2>
            <p>Try another name, or show every track.</p>
            <Button
              variant="default"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <table className="library-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th className="library-col-optional">Stems</th>
                <th className="library-col-optional">Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {tracks.map((track) => {
                const meta = statusMeta(track);
                const canProcess =
                  (Boolean(track.url) || track.source === "local") &&
                  (track.status === "queued" || track.status === "failed") &&
                  track.present < track.stems.length;
                return (
                  <tr
                    key={track.id}
                    className="library-row"
                    tabIndex={0}
                    onClick={() => router.push(track.href)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(track.href);
                      }
                    }}
                  >
                    <td>
                      <div className="library-title-cell">
                        <div className="library-thumb">
                          <WaveIcon />
                        </div>
                        <div className="library-title-text">
                          <strong>{track.title}</strong>
                          <span>{track.group || "YouTube"}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="library-status" data-tone={meta.tone}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="library-col-optional library-muted">
                      {track.present}/{track.stems.length}
                    </td>
                    <td className="library-col-optional library-muted">
                      {formatCreated(track.updatedAt)}
                    </td>
                    <td>
                      <div
                        className="library-actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {canProcess ? (
                          <Button
                            variant="primary"
                            size="small"
                            isPending={processingId === track.id}
                            disabled={processingId === track.id}
                            onClick={() => void processTrack(track.id)}
                          >
                            Process
                          </Button>
                        ) : track.status === "processing" ? (
                          <Button
                            variant="default"
                            size="small"
                            onClick={() => router.push("/processing")}
                          >
                            View job
                          </Button>
                        ) : (
                          <Button
                            variant="subtle"
                            size="small"
                            onClick={() => router.push(track.href)}
                          >
                            Open
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
