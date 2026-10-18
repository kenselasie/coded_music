import {
  Breadcrumb,
  Description,
  Detail,
  EmptyState,
  Heading,
  Stack,
} from "@kenselasie/codeddesign";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ComingSoonChords } from "@/components/ComingSoonChords";
import { StemMixer } from "@/components/StemMixer";
import { TrackActions } from "@/components/TrackActions";
import { readTrack } from "@/lib/stems";

export const dynamic = "force-dynamic";

export default async function TrackPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { slug } = await params;
  const track = await readTrack(session.user.id, slug);

  if (!track) {
    return (
      <EmptyState
        title="This song is not in your library"
        description="Add it from the library page with a YouTube link. Only songs you have added show up here."
      />
    );
  }

  const ready = track.present === track.stems.length;

  return (
    <Stack gap="l">
      <Breadcrumb
        items={[
          { label: "Library", href: "/" },
          { label: track.title },
        ]}
      />
      <Stack gap="xs">
        <Detail>{track.group || "Song"}</Detail>
        <Heading size="xxl" withoutMargins>
          {track.title}
        </Heading>
        <Description>
          {ready
            ? `6 of 6 stems${track.updatedAt ? ` · updated ${track.updatedAt}` : ""}`
            : track.status === "processing"
              ? "Processing stems…"
              : "Queued — process when you are ready"}
        </Description>
      </Stack>
      <TrackActions track={track} />
      {ready ? <StemMixer stems={track.stems} /> : null}
      <ComingSoonChords />
    </Stack>
  );
}
