import { createSupabaseAdminClient, getSupabaseBucket } from "@/lib/supabase";

export function getStorageDriver() {
  return "supabase" as const;
}

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
