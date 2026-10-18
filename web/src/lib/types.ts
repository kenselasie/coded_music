export const STEM_NAMES = [
  "vocals",
  "drums",
  "bass",
  "guitar",
  "piano",
  "other",
] as const;

export type StemName = (typeof STEM_NAMES)[number];

export type StemFile = {
  name: StemName;
  bytes: number | null;
  url: string | null;
};

export type TrackProcessStatus = "queued" | "processing" | "ready" | "failed";

export type TrackSummary = {
  id: string;
  slug: string;
  title: string;
  group: string;
  href: string;
  stems: StemFile[];
  present: number;
  updatedAt: string | null;
  status: TrackProcessStatus;
  url: string | null;
  source: string;
};

export type Library = {
  root: string;
  exists: boolean;
  tracks: TrackSummary[];
};
