import path from "path";
import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "./auth";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);

const EXT_TO_MIME: Record<string, string> = {
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

export { MAX_FILE_SIZE, MAX_FILES, MAX_TOTAL_SIZE } from "./upload-limits";

export function isAllowedMime(mime: string) {
  return ALLOWED_MIME.has(mime);
}

export function guessMimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? EXT_TO_MIME[ext] ?? null : null;
}

/** Best-effort content type for an upload, or null when we do not accept it. */
export function resolveMime(name: string, declared: string): string | null {
  const fromName = guessMimeFromName(name);
  if (declared && isAllowedMime(declared)) return declared;
  return fromName;
}

export { isImageMime, formatBytes } from "./file-utils";

export function buildStoredName(originalName: string) {
  const ext = path.extname(originalName).toLowerCase().slice(0, 10) || "";
  return `${Date.now()}-${randomUUID()}${ext}`;
}

/** Strip any directory components a client may have put in a filename. */
export function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\u0000-\u001f]/g, "").slice(0, 180) || "file";
}

export type UploadTicketFile = {
  storedName: string;
  originalName: string;
  mimeType: string;
  size: number;
};

const TICKET_AUDIENCE = "upload-ticket";

/**
 * Uploads go straight from the browser to Supabase, so `/api/submit` never sees
 * the bytes and cannot re-check them. This signed ticket is what ties the two
 * calls together: submit will only accept object names that we ourselves issued,
 * a few minutes ago, for files we already validated.
 */
export async function signUploadTicket(files: UploadTicketFile[]) {
  return new SignJWT({ files })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getJwtSecret());
}

export async function verifyUploadTicket(ticket: string): Promise<UploadTicketFile[] | null> {
  try {
    const { payload } = await jwtVerify(ticket, getJwtSecret(), {
      audience: TICKET_AUDIENCE,
    });
    const files = payload.files;
    if (!Array.isArray(files)) return null;
    return files as UploadTicketFile[];
  } catch {
    return null;
  }
}
