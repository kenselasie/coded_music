"use client";

import { Button, Inline, SectionMessage, Stack } from "@kenselasie/codeddesign";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TrackSummary } from "@/lib/types";

export function TrackActions({ track }: { track: TrackSummary }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const canProcess =
    (Boolean(track.url) || track.source === "local") &&
    (track.status === "queued" || track.status === "failed") &&
    track.present < track.stems.length;

  if (!canProcess && !error) return null;

  const process = async () => {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not start processing.");
        return;
      }
      router.push("/processing");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Stack gap="s">
      {canProcess ? (
        <Inline gap="s">
          <Button
            variant="primary"
            onClick={() => void process()}
            isPending={pending}
            disabled={pending}
          >
            Process stems
          </Button>
        </Inline>
      ) : null}
      {error ? (
        <SectionMessage variant="danger" title="Could not process">
          {error}
        </SectionMessage>
      ) : null}
    </Stack>
  );
}
