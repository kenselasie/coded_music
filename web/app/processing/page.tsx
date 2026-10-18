import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { JobBoard } from "@/components/JobBoard";
import { listJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function ProcessingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <JobBoard initialJobs={await listJobs(session.user.id)} />;
}
