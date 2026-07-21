import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

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

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
export const MAX_FILES = 20;

export function isAllowedMime(mime: string) {
  return ALLOWED_MIME.has(mime);
}

export { isImageMime, formatBytes } from "./file-utils";

export async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export function buildStoredName(originalName: string) {
  const ext = path.extname(originalName).toLowerCase() || "";
  return `${Date.now()}-${randomUUID()}${ext}`;
}

export function resolveUploadPath(storedName: string) {
  const full = path.join(UPLOAD_DIR, storedName);
  if (!full.startsWith(UPLOAD_DIR)) {
    throw new Error("Invalid file path");
  }
  return full;
}
