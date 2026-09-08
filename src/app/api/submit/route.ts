import { NextRequest, NextResponse } from "next/server";
import { createPrintJob, type NewPrintFile } from "@/lib/db";
import { deleteStoredFiles, statStoredFile } from "@/lib/storage";
import { verifyUploadTicket } from "@/lib/uploads";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Record a print job for files the browser has already uploaded to Supabase via
 * `/api/uploads`. Only metadata crosses this endpoint, which keeps it well under
 * Vercel's 4.5 MB request body ceiling no matter how big the documents are.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "submit", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  let body: { name?: unknown; phone?: unknown; notes?: unknown; ticket?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const notes = String(body.notes ?? "").trim();

  if (name.length < 2 || name.length > 120) {
    return NextResponse.json({ error: "Please enter your full name." }, { status: 400 });
  }

  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    return NextResponse.json(
      { error: "Please enter a valid 10-digit phone number." },
      { status: 400 }
    );
  }
  if (notes.length > 1000) {
    return NextResponse.json({ error: "Please shorten your notes." }, { status: 400 });
  }

  const ticket = typeof body.ticket === "string" ? body.ticket : "";
  const expected = ticket ? await verifyUploadTicket(ticket) : null;
  if (!expected || expected.length === 0) {
    return NextResponse.json(
      { error: "Your upload session expired. Please pick the files again." },
      { status: 400 }
    );
  }

  // Confirm each object really landed in storage before promising the shop that
  // the job exists, and take the size from storage rather than from the client.
  const stats = await Promise.all(expected.map((f) => statStoredFile(f.storedName)));
  const missing = expected.filter((_, i) => !stats[i]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `${missing.length} file(s) did not finish uploading. Please try again.` },
      { status: 400 }
    );
  }

  const files: NewPrintFile[] = expected.map((f, i) => ({
    originalName: f.originalName,
    storedName: f.storedName,
    mimeType: f.mimeType,
    size: stats[i]?.size || f.size,
  }));

  try {
    const job = await createPrintJob({
      name,
      phone: phoneDigits,
      notes: notes || null,
      files,
    });
    return NextResponse.json({ ok: true, jobId: job.id, fileCount: job.files.length });
  } catch (error) {
    // The upload succeeded but the job row did not, so nothing references these
    // objects any more.
    await deleteStoredFiles(files.map((f) => f.storedName)).catch(() => undefined);
    console.error("Submit error:", error);
    return NextResponse.json(
      { error: "Could not submit print job. Please try again." },
      { status: 500 }
    );
  }
}
