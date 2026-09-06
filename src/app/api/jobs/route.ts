import { NextRequest, NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/lib/auth";
import { listPrintJobs } from "@/lib/db";
import { JOB_STATUSES, type JobStatus } from "@/lib/jobs";

export async function GET(req: NextRequest) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const where =
    status && JOB_STATUSES.includes(status as JobStatus)
      ? { status }
      : undefined;

  const jobs = await listPrintJobs(where?.status);

  return NextResponse.json({ jobs });
}
