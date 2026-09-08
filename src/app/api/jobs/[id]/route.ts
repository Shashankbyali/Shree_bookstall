import { NextRequest, NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/lib/auth";
import { deletePrintJob, getPrintJob, updatePrintJobStatus } from "@/lib/db";
import { deleteStoredFiles } from "@/lib/storage";
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
  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
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
  // Remove the stored objects too, otherwise every deleted job leaves its
  // uploads orphaned in the bucket forever.
  const storedNames = await deletePrintJob(id);
  await deleteStoredFiles(storedNames).catch((error) =>
    console.error(`[Job] storage cleanup failed for ${id}:`, error)
  );
  return NextResponse.json({ ok: true, removedFiles: storedNames.length });
}
