import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { isOwnerAuthenticated } from "@/lib/auth";
import { getPrintFile, updatePrintFile } from "@/lib/db";
import { enhanceDocumentBuffer } from "@/lib/document-enhance-server";
import { buildStoredName, isImageMime } from "@/lib/uploads";
import { deleteStoredFile, downloadStoredFile, uploadStoredFile } from "@/lib/storage";

type Params = { params: Promise<{ id: string; fileId: string }> };

/** Server-side auto crop + brighten — no client processing needed. */
export async function POST(_req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const file = await getPrintFile(fileId, id);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (!isImageMime(file.mimeType)) {
    return NextResponse.json(
      { error: "Only images can be auto-enhanced." },
      { status: 400 }
    );
  }

  const newStored = buildStoredName(
    path.basename(file.originalName, path.extname(file.originalName)) + "-enhanced.jpg"
  );

  try {
    console.log(`[Enhance] Starting enhancement for fileId: ${fileId}, jobId: ${id}`);
    console.log(`[Enhance] Original file: ${file.originalName}, size: ${file.size} bytes, mime: ${file.mimeType}`);

    const original = await downloadStoredFile(file.storedName);
    console.log(`[Enhance] Downloaded original buffer: ${original.length} bytes`);

    const enhanced = await enhanceDocumentBuffer(original);
    console.log(`[Enhance] Enhanced buffer: ${enhanced.length} bytes`);

    await uploadStoredFile(newStored, enhanced, "image/jpeg");
    console.log(`[Enhance] Uploaded enhanced file: ${newStored}`);

    const updated = await updatePrintFile(fileId, {
        storedName: newStored,
        mimeType: "image/jpeg",
        size: enhanced.length,
        enhanced: true,
        originalName: file.originalName.replace(/\.[^.]+$/, "") + "-scan.jpg",
    });

    try {
      await deleteStoredFile(file.storedName);
      console.log(`[Enhance] Deleted original file: ${file.storedName}`);
    } catch {
      /* best effort */
    }

    console.log(`[Enhance] Enhancement completed successfully for fileId: ${fileId}`);
    return NextResponse.json({ file: updated });
  } catch (error) {
    await deleteStoredFile(newStored).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[Enhance] Enhancement failed for fileId: ${fileId}:`, {
      error: message,
      stack,
      jobId: id,
      fileId: fileId
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not enhance image. Please try again.",
      },
      { status: 500 }
    );
  }
}

/** Legacy: accept pre-processed file from client. */
export async function PUT(req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const file = await getPrintFile(fileId, id);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (!isImageMime(file.mimeType)) {
    return NextResponse.json(
      { error: "Only images can be auto-enhanced." },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const enhanced = form.get("file");
  if (!(enhanced instanceof File) || enhanced.size === 0) {
    return NextResponse.json({ error: "Missing enhanced file." }, { status: 400 });
  }

  const newStored = buildStoredName(
    path.basename(file.originalName, path.extname(file.originalName)) + "-enhanced.jpg"
  );
  const buffer = Buffer.from(await enhanced.arrayBuffer());

  try {
    await uploadStoredFile(newStored, buffer, "image/jpeg");

    const updated = await updatePrintFile(fileId, {
        storedName: newStored,
        mimeType: "image/jpeg",
        size: buffer.length,
        enhanced: true,
        originalName: file.originalName.replace(/\.[^.]+$/, "") + "-scan.jpg",
    });

    try {
      await deleteStoredFile(file.storedName);
    } catch {
      /* best effort */
    }

    return NextResponse.json({ file: updated });
  } catch (error) {
    await deleteStoredFile(newStored).catch(() => undefined);
    console.error("Enhance upload error:", error);
    return NextResponse.json(
      { error: "Could not save enhanced image." },
      { status: 500 }
    );
  }
}
