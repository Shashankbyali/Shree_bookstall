import { createSupabaseAdminClient, getSupabaseBucket } from "./supabase";

export async function uploadStoredFile(
  storedName: string,
  buffer: Buffer,
  contentType: string
) {
  const supabase = createSupabaseAdminClient();
  const bucket = getSupabaseBucket();
  const { error } = await supabase.storage.from(bucket).upload(storedName, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

export async function downloadStoredFile(storedName: string) {
  const supabase = createSupabaseAdminClient();
  const bucket = getSupabaseBucket();
  const { data, error } = await supabase.storage.from(bucket).download(storedName);
  if (error || !data) {
    throw new Error(`Download failed: ${error?.message || "File not found"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteStoredFile(storedName: string) {
  const supabase = createSupabaseAdminClient();
  const bucket = getSupabaseBucket();
  await supabase.storage.from(bucket).remove([storedName]);
}

export async function deleteStoredFiles(storedNames: string[]) {
  if (storedNames.length === 0) return;
  const supabase = createSupabaseAdminClient();
  const bucket = getSupabaseBucket();
  await supabase.storage.from(bucket).remove(storedNames);
}

/**
 * A short-lived URL the browser can PUT a file straight to.
 *
 * Vercel functions cap request bodies at 4.5 MB, which a single phone photo
 * routinely exceeds, so uploads must bypass the server entirely rather than be
 * proxied through it.
 */
export async function createSignedUpload(storedName: string) {
  const supabase = createSupabaseAdminClient();
  const bucket = getSupabaseBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storedName);

  if (error || !data?.signedUrl) {
    throw new Error(`Could not create upload URL: ${error?.message ?? "unknown error"}`);
  }
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/** Size + content type of an object, or null when it does not exist. */
export async function statStoredFile(storedName: string) {
  const supabase = createSupabaseAdminClient();
  const bucket = getSupabaseBucket();
  const slash = storedName.lastIndexOf("/");
  const dir = slash >= 0 ? storedName.slice(0, slash) : "";
  const base = slash >= 0 ? storedName.slice(slash + 1) : storedName;

  const { data, error } = await supabase.storage.from(bucket).list(dir, {
    search: base,
    limit: 100,
  });
  if (error || !data) return null;

  const match = data.find((entry) => entry.name === base);
  if (!match) return null;
  const meta = match.metadata as { size?: number; mimetype?: string } | null;
  return { size: meta?.size ?? 0, mimeType: meta?.mimetype ?? "application/octet-stream" };
}

/** Direct CDN URL — skips slow server proxy for Supabase files. */
export async function getStoredFileUrl(
  storedName: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = createSupabaseAdminClient();
  const bucket = getSupabaseBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storedName, expiresIn);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
