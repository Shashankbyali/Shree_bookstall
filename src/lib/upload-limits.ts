/**
 * Upload limits, in a module with no server-only imports so the browser can use
 * the same numbers the API enforces.
 */
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
export const MAX_FILES = 20;
export const MAX_TOTAL_SIZE = 120 * 1024 * 1024;

export { formatBytes, isImageMime } from "./file-utils";
