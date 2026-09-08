import { NextRequest, NextResponse } from "next/server";
import { createSignedUpload } from "@/lib/storage";
import {
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  buildStoredName,
  resolveMime,
  sanitizeFileName,
  signUploadTicket,
  type UploadTicketFile,
} from "@/lib/uploads";
import { formatBytes } from "@/lib/file-utils";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

type RequestedFile = { name?: unknown; size?: unknown; type?: unknown };

/**
 * Hand the browser one signed URL per file so it can upload straight to Supabase.
 *
 * Vercel functions reject request bodies over 4.5 MB, which a single phone photo
 * often exceeds, so the files must never pass through this server.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "uploads", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let body: { files?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const requested = Array.isArray(body.files) ? (body.files as RequestedFile[]) : [];
  if (requested.length === 0) {
    return NextResponse.json({ error: "Please choose at least one file." }, { status: 400 });
  }
  if (requested.length > MAX_FILES) {
    return NextResponse.json(
      { error: `You can upload up to ${MAX_FILES} files.` },
      { status: 400 }
    );
  }

  const files: UploadTicketFile[] = [];
  let total = 0;

  for (const entry of requested) {
    const originalName = sanitizeFileName(String(entry.name ?? ""));
    const size = Number(entry.size);

    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: `${originalName} looks empty.` }, { status: 400 });
    }
    if (size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `${originalName} is too large (max ${formatBytes(MAX_FILE_SIZE)}).` },
        { status: 400 }
      );
    }

    const mimeType = resolveMime(originalName, String(entry.type ?? ""));
    if (!mimeType) {
      return NextResponse.json(
        { error: `${originalName} is not a supported type. Use PDF, images, Word, PPT, or text.` },
        { status: 400 }
      );
    }

    total += size;
    files.push({ storedName: buildStoredName(originalName), originalName, mimeType, size });
  }

  if (total > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { error: `That is ${formatBytes(total)} in total; the limit is ${formatBytes(MAX_TOTAL_SIZE)}.` },
      { status: 400 }
    );
  }

  try {
    const uploads = await Promise.all(
      files.map(async (file) => ({
        ...file,
        ...(await createSignedUpload(file.storedName)),
      }))
    );
    // The ticket is what /api/submit trusts: it proves these object names were
    // issued by us, for files we validated, within the last few minutes.
    const ticket = await signUploadTicket(files);
    return NextResponse.json({ ticket, uploads });
  } catch (error) {
    console.error("Signed upload error:", error);
    return NextResponse.json(
      { error: "Could not start the upload. Please try again." },
      { status: 500 }
    );
  }
}
