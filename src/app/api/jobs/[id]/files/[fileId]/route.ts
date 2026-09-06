import { NextRequest, NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/lib/auth";
import { getPrintFile } from "@/lib/db";
import { createThumbnailBuffer } from "@/lib/document-enhance-server";
import { isImageMime } from "@/lib/uploads";
import {
  downloadStoredFile,
  getStorageDriver,
  getStoredFileUrl,
} from "@/lib/storage";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const file = await getPrintFile(fileId, id);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  const thumb = req.nextUrl.searchParams.get("thumb") === "1";

  // Fast path: redirect to Supabase CDN (skip slow server proxy)
  if (
    getStorageDriver() === "supabase" &&
    !thumb &&
    req.nextUrl.searchParams.get("proxy") !== "1"
  ) {
    const signedUrl = await getStoredFileUrl(file.storedName, download ? 300 : 600);
    if (signedUrl) {
      if (download) {
        const sep = signedUrl.includes("?") ? "&" : "?";
        return NextResponse.redirect(
          `${signedUrl}${sep}download=${encodeURIComponent(file.originalName)}`
        );
      }
      return NextResponse.redirect(signedUrl);
    }
  }

  let buffer: Buffer;
  try {
    buffer = await downloadStoredFile(file.storedName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("File not found")) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    throw error;
  }

  if (thumb && isImageMime(file.mimeType)) {
    buffer = await createThumbnailBuffer(buffer);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const disposition = download ? "attachment" : "inline";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(file.originalName)}"`,
      "Cache-Control": "private, max-age=600",
    },
  });
}
