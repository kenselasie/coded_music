"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Description,
  Inline,
  SectionMessage,
  Stack,
  Status,
  TextField,
} from "@kenselasie/codeddesign";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

async function readJson(response: Response) {
  return (await response.json()) as {
    job?: { id: string } | null;
    entry?: { id: string; title: string; artist: string; status: string } | null;
    error?: string;
  };
}

export function YoutubeSplit() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<
    "add" | "split" | "upload" | "upload-split" | null
  >(null);

  const busy = submitting !== null;

  const addToLibrary = async () => {
    setError(null);
    setNotice(null);
    setSubmitting("add");
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        setError(data.error ?? "Could not add that song.");
        return;
      }
      setUrl("");
      setNotice(
        data.entry
          ? `Added “${data.entry.title}” to the library.`
          : "Song added to your library.",
      );
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(null);
    }
  };

  const splitNow = async () => {
    setError(null);
    setNotice(null);
    setSubmitting("split");
    try {
      const saved = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const savedData = await readJson(saved);
      const trackId =
        saved.ok || saved.status === 409 ? savedData.entry?.id : undefined;
      if (!saved.ok && saved.status !== 409) {
        setError(savedData.error ?? "Could not add that song.");
        return;
      }

      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trackId ? { trackId } : { url }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        setError(data.error ?? "Could not start processing.");
        return;
      }
      setUrl("");
      router.push("/processing");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(null);
    }
  };

  const uploadLocal = async (alsoSplit: boolean) => {
    if (!file) {
      setError("Choose an audio file from this computer.");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(alsoSplit ? "upload-split" : "upload");
    try {
      const body = new FormData();
      body.set("file", file);
      const saved = await fetch("/api/library/upload", {
        method: "POST",
        body,
      });
      const savedData = await readJson(saved);
      if (!saved.ok) {
        setError(savedData.error ?? "Could not upload that file.");
        return;
      }
      const trackId = savedData.entry?.id;
      if (!alsoSplit) {
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        setNotice(
          savedData.entry
            ? `Added “${savedData.entry.title}” from this computer.`
            : "Local file added to your library.",
        );
        router.push("/");
        router.refresh();
        return;
      }
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        setError(data.error ?? "File saved, but processing could not start.");
        return;
      }
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.push("/processing");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Stack gap="m">
      <Card>
        <CardHeader>
          <CardTitle>This computer</CardTitle>
          <Status status={busy ? "live" : "neutral"}>
            {busy ? "Working" : "Local"}
          </Status>
        </CardHeader>
        <CardContent>
          <Stack gap="m">
            <Description>
              Upload an audio file from your PC. Stem separation runs on this
              machine (your GPU/CPU), not in the browser.
            </Description>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg,.aiff,.aif"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? <Description>Selected: {file.name}</Description> : null}
            <Inline gap="s">
              <Button
                variant="default"
                onClick={() => void uploadLocal(false)}
                isPending={submitting === "upload"}
                disabled={busy || !file}
              >
                Add to library
              </Button>
              <Button
                variant="primary"
                onClick={() => void uploadLocal(true)}
                isPending={submitting === "upload-split"}
                disabled={busy || !file}
              >
                Split on this PC
              </Button>
            </Inline>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>YouTube link</CardTitle>
          <Status status={busy ? "live" : "neutral"}>
            {busy ? "Working" : "Ready"}
          </Status>
        </CardHeader>
        <CardContent>
          <Stack gap="m">
            <Description>
              Download from YouTube, then separate stems on this computer.
            </Description>
            <TextField
              label="YouTube link"
              type="url"
              value={url}
              onChange={setUrl}
              placeholder="https://www.youtube.com/watch?v=…"
              disabled={busy}
            />
            <Inline gap="s">
              <Button
                variant="default"
                onClick={() => void addToLibrary()}
                isPending={submitting === "add"}
                disabled={busy || url.trim().length === 0}
              >
                Add to library
              </Button>
              <Button
                variant="primary"
                onClick={() => void splitNow()}
                isPending={submitting === "split"}
                disabled={busy || url.trim().length === 0}
              >
                Split on this PC
              </Button>
            </Inline>
          </Stack>
        </CardContent>
      </Card>

      {error ? (
        <SectionMessage variant="danger" title="Could not continue">
          {error}
        </SectionMessage>
      ) : null}

      {notice ? (
        <SectionMessage variant="success" title="Saved">
          {notice}
        </SectionMessage>
      ) : null}
    </Stack>
  );
}
