export type JobStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
};

export type JobRecord = {
  id: string;
  url: string;
  audioPath?: string | null;
  status: "queued" | "running" | "done" | "failed";
  step: number;
  stepKey: string;
  steps: JobStep[];
  title: string | null;
  artist: string | null;
  trackId: string | null;
  href: string | null;
  error: string | null;
  detail?: string;
  updatedAt: string;
  pid?: number;
};
