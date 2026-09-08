import { NextRequest, NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/lib/auth";
import { getPrintFile } from "@/lib/db";
import {
  createPreviewBuffer,
  createThumbnailBuffer,
} from "@/lib/document-enhance-server";
import { isImageMime } from "@/lib/uploads";
import { downloadStoredFile, getStoredFileUrl } from "@/lib/storage";

type Params = { params: Promise<{ id: string; fileId: string }> };

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const file = await getPrintFile(fileId, id);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const params_ = req.nextUrl.searchParams;
  const download = params_.get("download") === "1";
  const thumb = params_.get("thumb") === "1";
  const preview = params_.get("preview") === "1";
  // The crop editor must always draw the untouched upload, otherwise the owner
  // would be cropping an already-cropped image.
  const wantSource = params_.get("source") === "1";

  const storedName = wantSource ? file.sourceStoredName ?? file.storedName : file.storedName;
  const mimeType = wantSource ? file.sourceMimeType ?? file.mimeType : file.mimeType;
  const displayName = wantSource ? file.sourceName ?? file.originalName : file.originalName;

  // Fast path: redirect to the Supabase CDN instead of streaming through the
  // function. Resized variants have to be generated here, so they skip it.
  if (!thumb && !preview && params_.get("proxy") !== "1") {
    const signedUrl = await getStoredFileUrl(storedName, download ? 300 : 600);
    if (signedUrl) {
      if (download) {
        const sep = signedUrl.includes("?") ? "&" : "?";
        return NextResponse.redirect(
          `${signedUrl}${sep}download=${encodeURIComponent(displayName)}`
        );
      }
      return NextResponse.redirect(signedUrl);
    }
  }

  let buffer: Buffer;
  try {
    buffer = await downloadStoredFile(storedName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("File not found")) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    console.error(`[File] download failed for ${storedName}:`, error);
    return NextResponse.json({ error: "Could not read this file." }, { status: 500 });
  }

  if ((thumb || preview) && isImageMime(mimeType)) {
    try {
      const resized = thumb
        ? await createThumbnailBuffer(buffer)
        : await createPreviewBuffer(buffer);
      return new Response(new Uint8Array(resized), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      console.error(`[File] resize failed for ${storedName}:`, error);
      return NextResponse.json({ error: "Could not render a preview." }, { status: 500 });
    }
  }

  const disposition = download ? "attachment" : "inline";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(displayName)}`,
      "Cache-Control": "private, max-age=600",
    },
  });
}
