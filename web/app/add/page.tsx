import { Description, Stack } from "@kenselasie/codeddesign";

import { YoutubeSplit } from "@/components/YoutubeSplit";

export const dynamic = "force-dynamic";

export default function AddPage() {
  return (
    <div>
      <header className="page-header">
        <div className="page-header-title">
          <h1>Add song</h1>
          <span className="page-header-count">YouTube</span>
        </div>
      </header>
      <Stack gap="m">
        <Description>
          Upload a file from this computer or paste a YouTube link. Separation
          always runs locally on this machine.
        </Description>
        <YoutubeSplit />
      </Stack>
    </div>
  );
}
