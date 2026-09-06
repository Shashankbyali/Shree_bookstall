import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function getSupabaseBucket() {
  return getEnv("SUPABASE_BUCKET") || "print-files";
}

export function createSupabaseAdminClient() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for production storage."
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}