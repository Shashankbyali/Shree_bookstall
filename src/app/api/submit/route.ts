import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import {
  MAX_FILE_SIZE,
  MAX_FILES,
  buildStoredName,
  ensureUploadDir,
  isAllowedMime,
  resolveUploadPath,
} from "@/lib/uploads";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();

    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "Please enter your full name." },
        { status: 400 }
      );
    }

    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      return NextResponse.json(
        { error: "Please enter a valid 10-digit phone number." },
        { status: 400 }
      );
    }

    const files = form
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Please upload at least one file." },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `You can upload up to ${MAX_FILES} files.` },
        { status: 400 }
      );
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `${file.name} is too large (max 25MB).` },
          { status: 400 }
        );
      }
      if (!isAllowedMime(file.type) && !guessMimeFromName(file.name)) {
        return NextResponse.json(
          {
            error: `${file.name} type is not supported. Use PDF, images, Word, PPT, or text.`,
          },
          { status: 400 }
        );
      }
    }

    await ensureUploadDir();

    const saved: {
      originalName: string;
      storedName: string;
      mimeType: string;
      size: number;
    }[] = [];

    for (const file of files) {
      const mime = file.type || guessMimeFromName(file.name) || "application/octet-stream";
      const storedName = buildStoredName(file.name);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(resolveUploadPath(storedName), buffer);
      saved.push({
        originalName: file.name,
        storedName,
        mimeType: mime,
        size: file.size,
      });
    }

    const job = await prisma.printJob.create({
      data: {
        name,
        phone: phoneDigits,
        notes: notes || null,
        files: {
          create: saved,
        },
      },
      include: { files: true },
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      fileCount: job.files.length,
    });
  } catch (err) {
    console.error("Submit error:", err);
    return NextResponse.json(
      { error: "Could not submit print job. Please try again." },
      { status: 500 }
    );
  }
}

function guessMimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
  };
  return ext ? map[ext] ?? null : null;
}
