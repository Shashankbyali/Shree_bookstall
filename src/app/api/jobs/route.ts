import { NextRequest, NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
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

  const jobs = await prisma.printJob.findMany({
    where,
    include: {
      files: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ jobs });
}
