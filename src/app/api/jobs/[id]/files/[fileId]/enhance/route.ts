import { NextRequest, NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/lib/auth";
import { getPrintFile, updatePrintFile, type PrintFile } from "@/lib/db";
import {
  DEFAULT_ENHANCE_SETTINGS,
  detectCrop,
  enhanceDocumentBuffer,
  normalizeSettings,
  type EnhanceSettings,
} from "@/lib/document-enhance-server";
import { isValidNormalizedCrop } from "@/lib/document-detect";
import { buildStoredName, isImageMime } from "@/lib/uploads";
import { deleteStoredFile, downloadStoredFile, uploadStoredFile } from "@/lib/storage";

type Params = { params: Promise<{ id: string; fileId: string }> };

export const runtime = "nodejs";
// A 12MP photo takes a few seconds to decode, analyse and re-encode, on top of
// the download and upload. The platform default (10s on Hobby) is too tight.
export const maxDuration = 60;

/** The untouched upload: the source if one was kept, otherwise the file itself. */
function sourceOf(file: PrintFile) {
  return {
    storedName: file.sourceStoredName ?? file.storedName,
    mimeType: file.sourceMimeType ?? file.mimeType,
    size: file.sourceSize ?? file.size,
    name: file.sourceName ?? file.originalName,
  };
}

async function loadEditableFile(id: string, fileId: string) {
  const file = await getPrintFile(fileId, id);
  if (!file) {
    return { error: NextResponse.json({ error: "File not found" }, { status: 404 }) };
  }
  const source = sourceOf(file);
  if (!isImageMime(source.mimeType)) {
    return {
      error: NextResponse.json(
        { error: "Only images can be auto-enhanced." },
        { status: 400 }
      ),
    };
  }
  return { file, source };
}

/** Current settings plus a suggested auto-crop, for opening the editor. */
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const loaded = await loadEditableFile(id, fileId);
  if (loaded.error) return loaded.error;

  try {
    const original = await downloadStoredFile(loaded.source.storedName);
    const suggested = await detectCrop(original);
    return NextResponse.json({
      settings: loaded.file.enhanceSettings ?? DEFAULT_ENHANCE_SETTINGS,
      suggestedCrop: suggested,
      enhanced: loaded.file.enhanced,
    });
  } catch (error) {
    console.error(`[Enhance] detect failed for ${fileId}:`, error);
    return NextResponse.json(
      { error: "Could not analyse this image." },
      { status: 500 }
    );
  }
}

/**
 * Apply auto crop + brighten, or an explicit crop and brightness/contrast.
 *
 * Always reads the original upload, never the previously enhanced output, so
 * repeated adjustments do not compound and the customer's file is recoverable.
 */
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const loaded = await loadEditableFile(id, fileId);
  if (loaded.error) return loaded.error;
  const { file, source } = loaded;

  let raw: unknown = {};
  try {
    const text = await req.text();
    if (text) raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const payload = (raw ?? {}) as Record<string, unknown>;
  const settings: EnhanceSettings = normalizeSettings(payload);
  if (payload.crop !== undefined && payload.crop !== null) {
    if (!isValidNormalizedCrop(payload.crop)) {
      return NextResponse.json({ error: "Invalid crop area." }, { status: 400 });
    }
    settings.crop = payload.crop;
  }

  const newStored = buildStoredName(stripExt(source.name) + "-scan.jpg");
  // The previous enhanced output, if any — removed only after the new one is in.
  const staleStored = file.sourceStoredName ? file.storedName : null;

  try {
    const original = await downloadStoredFile(source.storedName);
    const result = await enhanceDocumentBuffer(original, settings);
    await uploadStoredFile(newStored, result.buffer, "image/jpeg");

    const updated = await updatePrintFile(fileId, {
      storedName: newStored,
      mimeType: "image/jpeg",
      size: result.buffer.length,
      enhanced: true,
      originalName: stripExt(source.name) + "-scan.jpg",
      // Recorded on the first edit and kept from then on.
      sourceStoredName: source.storedName,
      sourceMimeType: source.mimeType,
      sourceSize: source.size,
      sourceName: source.name,
      enhanceSettings: {
        crop: result.crop,
        brightness: settings.brightness,
        contrast: settings.contrast,
        grayscale: settings.grayscale,
      },
    });

    if (staleStored && staleStored !== newStored) {
      await deleteStoredFile(staleStored).catch(() => undefined);
    }

    return NextResponse.json({ file: updated, crop: result.crop });
  } catch (error) {
    await deleteStoredFile(newStored).catch(() => undefined);
    console.error(`[Enhance] failed for job ${id} file ${fileId}:`, error);
    // Deliberately generic: sharp's messages ("Input buffer contains unsupported
    // image format") leak internals and mean nothing to a shopkeeper.
    return NextResponse.json(
      { error: "Could not edit this image. The original file is unchanged." },
      { status: 500 }
    );
  }
}

/** Undo every edit and put the customer's original upload back in place. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const file = await getPrintFile(fileId, id);
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!file.sourceStoredName) {
    return NextResponse.json({ error: "This file has no edits to undo." }, { status: 400 });
  }

  const enhancedStored = file.storedName;
  const updated = await updatePrintFile(fileId, {
    storedName: file.sourceStoredName,
    mimeType: file.sourceMimeType ?? "application/octet-stream",
    size: file.sourceSize ?? 0,
    originalName: file.sourceName ?? file.originalName,
    enhanced: false,
    sourceStoredName: null,
    sourceMimeType: null,
    sourceSize: null,
    sourceName: null,
    enhanceSettings: null,
  });

  if (enhancedStored !== updated.storedName) {
    await deleteStoredFile(enhancedStored).catch(() => undefined);
  }

  return NextResponse.json({ file: updated });
}

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}
