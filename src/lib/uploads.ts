import path from "path";
import { randomUUID } from "crypto";

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

export function buildStoredName(originalName: string) {
  const ext = path.extname(originalName).toLowerCase() || "";
  return `${Date.now()}-${randomUUID()}${ext}`;
}
