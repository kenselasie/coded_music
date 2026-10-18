"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Description,
  Detail,
  Grid,
  Inline,
  SectionMessage,
  Slider,
  Stack,
  Status,
  Tag,
} from "@kenselasie/codeddesign";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatBytes, formatTime } from "@/lib/format";
import type { StemFile, StemName } from "@/lib/types";

function useColumns(desktop: number) {
  const [columns, setColumns] = useState(desktop);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const apply = () => setColumns(query.matches ? 1 : desktop);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [desktop]);
  return columns;
}

type MixState = {
  muted: boolean;
  solo: boolean;
  volume: number;
};

const silent = (): MixState => ({ muted: false, solo: false, volume: 100 });

export function StemMixer({ stems }: { stems: StemFile[] }) {
  const columns = useColumns(2);
  const present = useMemo(
    () => stems.filter((stem): stem is StemFile & { url: string } => stem.url !== null),
    [stems],
  );
  const missing = stems.filter((stem) => stem.url === null).map((stem) => stem.name);

  const [mix, setMix] = useState<Record<StemName, MixState>>(() =>
    Object.fromEntries(stems.map((stem) => [stem.name, silent()])) as Record<
      StemName,
      MixState
    >,
  );
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const buffers = useRef<Partial<Record<StemName, AudioBuffer>>>({});
  const gains = useRef<Partial<Record<StemName, GainNode>>>({});
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const runId = useRef(0);
  const startedAt = useRef(0);
  const offsetRef = useRef(0);
  const durationRef = useRef(0);
  const playingRef = useRef(false);
  const hold = useRef(false);
  const seekTimer = useRef<number | null>(null);
  const mixRef = useRef(mix);
  mixRef.current = mix;
  playingRef.current = playing;

  const applyGains = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const anySolo = present.some((stem) => mixRef.current[stem.name]?.solo);
    for (const stem of present) {
      const gain = gains.current[stem.name];
      const state = mixRef.current[stem.name];
      if (!gain || !state) continue;
      const audible = anySolo ? state.solo : !state.muted;
      gain.gain.setTargetAtTime(audible ? state.volume / 100 : 0, ctx.currentTime, 0.015);
    }
  };

  const halt = () => {
    runId.current += 1;
    for (const source of sources.current) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    }
    sources.current = [];
  };

  const start = (offset: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    halt();
    const id = runId.current;
    const length = durationRef.current;
    const from = Math.min(Math.max(offset, 0), Math.max(length - 0.01, 0));
    offsetRef.current = from;
    startedAt.current = ctx.currentTime - from;
    let ended = 0;
    let started = 0;
    for (const stem of present) {
      const buffer = buffers.current[stem.name];
      const gain = gains.current[stem.name];
      if (!buffer || !gain || from >= buffer.duration) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => {
        if (runId.current !== id) return;
        ended += 1;
        if (ended >= started) {
          playingRef.current = false;
          setPlaying(false);
          offsetRef.current = 0;
          setPosition(0);
        }
      };
      source.start(0, from);
      sources.current.push(source);
      started += 1;
    }
    applyGains();
    if (started === 0) {
      playingRef.current = false;
      setPlaying(false);
      offsetRef.current = 0;
      setPosition(0);
    }
  };

  const loadBuffers = async () => {
    const ctx = ctxRef.current ?? new AudioContext();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    await Promise.all(
      present.map(async (stem) => {
        if (buffers.current[stem.name]) return;
        const response = await fetch(stem.url);
        if (!response.ok) throw new Error(`Could not read ${stem.name}`);
        const audio = await ctx.decodeAudioData(await response.arrayBuffer());
        buffers.current[stem.name] = audio;
        if (!gains.current[stem.name]) {
          const gain = ctx.createGain();
          gain.connect(ctx.destination);
          gains.current[stem.name] = gain;
        }
      }),
    );
    const longest = Math.max(
      0,
      ...present.map((stem) => buffers.current[stem.name]?.duration ?? 0),
    );
    durationRef.current = longest;
    setDuration(longest);
    applyGains();
  };

  useEffect(() => {
    applyGains();
  }, [mix]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const ctx = ctxRef.current;
      if (ctx && !hold.current) {
        const elapsed = ctx.currentTime - startedAt.current;
        setPosition(Math.min(Math.max(elapsed, 0), durationRef.current));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    return () => {
      if (seekTimer.current !== null) window.clearTimeout(seekTimer.current);
      halt();
      void ctxRef.current?.close();
    };
  }, []);

  const play = async () => {
    setError(null);
    setLoading(true);
    try {
      await loadBuffers();
      playingRef.current = true;
      setPlaying(true);
      start(offsetRef.current);
    } catch (caught) {
      playingRef.current = false;
      setPlaying(false);
      setError(caught instanceof Error ? caught.message : "Could not play these stems");
    } finally {
      setLoading(false);
    }
  };

  const pause = () => {
    const ctx = ctxRef.current;
    if (ctx) {
      const elapsed = ctx.currentTime - startedAt.current;
      offsetRef.current = Math.min(Math.max(elapsed, 0), durationRef.current);
      setPosition(offsetRef.current);
    }
    halt();
    playingRef.current = false;
    setPlaying(false);
  };

  const onSeek = (next: number) => {
    hold.current = true;
    setPosition(next);
    if (seekTimer.current !== null) window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => {
      offsetRef.current = next;
      hold.current = false;
      if (playingRef.current) start(next);
    }, 160);
  };

  const patch = (name: StemName, next: Partial<MixState>) => {
    setMix((current) => ({
      ...current,
      [name]: { ...current[name], ...next },
    }));
  };

  return (
    <Stack gap="l">
      <Card>
        <CardHeader>
          <CardTitle>Mix</CardTitle>
          <Status status={playing ? "live" : "neutral"}>
            {playing ? "Playing" : "Stopped"}
          </Status>
        </CardHeader>
        <CardContent>
          <Stack gap="m">
            <Description>
              {present.length} of {stems.length} stems are in this folder.
              {duration > 0 ? ` Length ${formatTime(duration)}.` : ""}
            </Description>
            <Inline gap="s">
              <Button
                variant="primary"
                onClick={() => (playing ? pause() : void play())}
                isPending={loading}
                disabled={present.length === 0}
              >
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                variant="default"
                disabled={present.length === 0 || (position === 0 && !playing)}
                onClick={() => {
                  offsetRef.current = 0;
                  setPosition(0);
                  if (playingRef.current) start(0);
                }}
              >
                Start over
              </Button>
            </Inline>
            <Slider
              label="Position"
              min={0}
              max={Math.max(1, Math.ceil(duration))}
              step={1}
              value={Math.min(Math.round(position), Math.max(1, Math.ceil(duration)))}
              onChange={onSeek}
            />
            <Detail>
              {formatTime(position)} / {formatTime(duration)}
            </Detail>
          </Stack>
        </CardContent>
      </Card>

      {error ? (
        <SectionMessage variant="danger" title="Playback failed">
          {error}
        </SectionMessage>
      ) : null}

      {missing.length > 0 ? (
        <SectionMessage variant="warning" title="Some stems are still missing">
          {missing.join(", ")} {missing.length === 1 ? "is" : "are"} not in this folder yet.
        </SectionMessage>
      ) : null}

      <Grid columns={columns} gap="m">
        {stems.map((stem) => {
          const state = mix[stem.name];
          const ready = stem.url !== null && stem.bytes !== null;
          return (
            <Card key={stem.name}>
              <CardHeader>
                <CardTitle>
                  {stem.name.charAt(0).toUpperCase() + stem.name.slice(1)}
                </CardTitle>
                <Tag status={ready ? "success" : "warning"} variant={ready ? "filled" : "outlined"}>
                  {ready ? "Ready" : "Missing"}
                </Tag>
              </CardHeader>
              <CardContent>
                {ready ? (
                  <Stack gap="s">
                    <Detail>{formatBytes(stem.bytes ?? 0)}</Detail>
                    <Slider
                      label="Volume"
                      min={0}
                      max={100}
                      value={state.volume}
                      onChange={(volume) => patch(stem.name, { volume })}
                    />
                    <Inline gap="xs">
                      <Button
                        variant="subtle"
                        size="small"
                        selected={state.muted}
                        onClick={() => patch(stem.name, { muted: !state.muted, solo: false })}
                      >
                        {state.muted ? "Muted" : "Mute"}
                      </Button>
                      <Button
                        variant="default"
                        size="small"
                        selected={state.solo}
                        onClick={() => patch(stem.name, { solo: !state.solo, muted: false })}
                      >
                        Solo
                      </Button>
                    </Inline>
                  </Stack>
                ) : (
                  <Description>This stem has not been written yet.</Description>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Grid>
    </Stack>
  );
}
