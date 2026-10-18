"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Description,
  Inline,
  SectionMessage,
  Stack,
  Status,
  Tag,
} from "@kenselasie/codeddesign";

const SOURCES = ["Piano", "Guitar", "Bass", "Other"] as const;

export function ComingSoonChords() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chord progression</CardTitle>
        <Status status="pending">Coming soon</Status>
      </CardHeader>
      <CardContent>
        <Stack gap="m">
          <Description>
            Read chord progressions from the piano stem, or from other harmonic
            instruments when the piano part is thin.
          </Description>
          <Inline gap="xs">
            {SOURCES.map((source) => (
              <Tag key={source} status="subtle" variant="outlined">
                {source}
              </Tag>
            ))}
          </Inline>
          <SectionMessage variant="info" title="On the roadmap">
            This will estimate keys and progressions after stems are ready. Nothing
            to run yet.
          </SectionMessage>
        </Stack>
      </CardContent>
    </Card>
  );
}
