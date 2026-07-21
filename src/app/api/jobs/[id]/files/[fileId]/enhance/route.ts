import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { isOwnerAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildStoredName,
  isImageMime,
  resolveUploadPath,
} from "@/lib/uploads";

type Params = { params: Promise<{ id: string; fileId: string }> };

/** Replace an image file with an enhanced (cropped/brightened) version. */
export async function PUT(req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const file = await prisma.printFile.findFirst({
    where: { id: fileId, jobId: id },
  });

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
  await fs.writeFile(resolveUploadPath(newStored), buffer);

  // Remove old file (best effort)
  try {
    await fs.unlink(resolveUploadPath(file.storedName));
  } catch {
    /* ignore */
  }

  const updated = await prisma.printFile.update({
    where: { id: fileId },
    data: {
      storedName: newStored,
      mimeType: "image/jpeg",
      size: buffer.length,
      enhanced: true,
      originalName: file.originalName.replace(/\.[^.]+$/, "") + "-scan.jpg",
    },
  });

  return NextResponse.json({ file: updated });
}
