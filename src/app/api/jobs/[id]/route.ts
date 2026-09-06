import { NextRequest, NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/lib/auth";
import { deletePrintJob, getPrintJob, updatePrintJobStatus } from "@/lib/db";
import { JOB_STATUSES, type JobStatus } from "@/lib/jobs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await getPrintJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const status = String(body.status ?? "");

  if (!JOB_STATUSES.includes(status as JobStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const job = await updatePrintJobStatus(id, status);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ job });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await deletePrintJob(id);
  return NextResponse.json({ ok: true });
}
