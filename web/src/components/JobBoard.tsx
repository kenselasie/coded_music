"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Description,
  Detail,
  EmptyState,
  Heading,
  Inline,
  SectionMessage,
  Stack,
  Status,
  Step,
} from "@kenselasie/codeddesign";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { JobRecord } from "@/lib/jobTypes";

function jobStatus(job: JobRecord) {
  if (job.status === "done") return { status: "success" as const, label: "Ready" };
  if (job.status === "failed") return { status: "error" as const, label: "Failed" };
  if (job.status === "queued") return { status: "pending" as const, label: "Queued" };
  return { status: "live" as const, label: "Working" };
}

function JobCard({ job }: { job: JobRecord }) {
  const router = useRouter();
  const meta = jobStatus(job);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{job.title ?? "YouTube song"}</CardTitle>
        <Status status={meta.status}>{meta.label}</Status>
      </CardHeader>
      <CardContent>
        <Stack gap="m">
          {job.artist ? <Detail>{job.artist}</Detail> : null}
          {job.detail && job.status === "running" ? (
            <Description>{job.detail}</Description>
          ) : null}
          <Detail>Updated {job.updatedAt}</Detail>
          <Stack gap="s">
            {job.steps.map((step, index) => (
              <Step
                key={step.key}
                number={index + 1}
                label={step.label}
                active={step.status === "active"}
                complete={step.status === "done"}
                isBlocked
              />
            ))}
          </Stack>
          {job.status === "failed" && job.error ? (
            <SectionMessage variant="danger" title="Processing stopped">
              {job.error}
            </SectionMessage>
          ) : null}
          {job.status === "done" && job.href ? (
            <Inline gap="s">
              <Button variant="primary" onClick={() => router.push(job.href!)}>
                Open stems
              </Button>
              <Button variant="subtle" onClick={() => router.push("/")}>
                Library
              </Button>
            </Inline>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function JobBoard({ initialJobs }: { initialJobs: JobRecord[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  const hasActive = jobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch("/api/jobs/list", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { jobs?: JobRecord[] };
        if (!cancelled && data.jobs) setJobs(data.jobs);
      } catch {
        /* keep previous */
      }
    };
    const id = window.setInterval(() => void tick(), hasActive ? 1500 : 5000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hasActive]);

  const active = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  );
  const recent = jobs.filter(
    (job) => job.status === "done" || job.status === "failed",
  );

  const countLabel =
    jobs.length === 1 ? "1 job" : `${jobs.length} jobs`;

  return (
    <Stack gap="l">
      <header className="page-header">
        <div className="page-header-title">
          <h1>Processing</h1>
          <span className="page-header-count">{countLabel}</span>
        </div>
        <div className="page-header-tools">
          <Button variant="subtle" onClick={() => router.refresh()}>
            Refresh
          </Button>
          <Button variant="primary" onClick={() => router.push("/add")}>
            + Add
          </Button>
        </div>
      </header>

      <Stack gap="m">
        <Heading size="l" withoutMargins>
          In progress
        </Heading>
        {active.length === 0 ? (
          <EmptyState
            title="Nothing is processing"
            description="Queued songs wait in the library until you press Process."
            action={
              <Button variant="default" onClick={() => router.push("/")}>
                Go to library
              </Button>
            }
          />
        ) : (
          active.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </Stack>

      <Stack gap="m">
        <Heading size="l" withoutMargins>
          Recent
        </Heading>
        {recent.length === 0 ? (
          <EmptyState
            title="No finished jobs yet"
            description="Completed and failed runs show up here."
          />
        ) : (
          recent.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </Stack>
    </Stack>
  );
}
