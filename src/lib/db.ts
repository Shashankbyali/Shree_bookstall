import { createSupabaseAdminClient } from "@/lib/supabase";

export type PrintFile = {
  id: string;
  jobId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  enhanced: boolean;
  createdAt: string;
};

export type PrintJob = {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  files: PrintFile[];
};

const JOBS_TABLE = "PrintJob";
const FILES_TABLE = "PrintFile";

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function getFiles(jobId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(FILES_TABLE)
    .select("*")
    .eq("jobId", jobId)
    .order("createdAt", { ascending: true });
  throwIfError(error);
  return (data ?? []) as PrintFile[];
}

export async function listPrintJobs(status?: string) {
  const supabase = createSupabaseAdminClient();
  let query = supabase.from(JOBS_TABLE).select("*").order("createdAt", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  throwIfError(error);

  return Promise.all(
    ((data ?? []) as Omit<PrintJob, "files">[]).map(async (job) => ({
      ...job,
      files: await getFiles(job.id),
    }))
  );
}

export async function getPrintJob(id: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;

  return { ...(data as Omit<PrintJob, "files">), files: await getFiles(id) };
}

export async function getPrintFile(id: string, jobId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(FILES_TABLE)
    .select("*")
    .eq("id", id)
    .eq("jobId", jobId)
    .maybeSingle();
  throwIfError(error);
  return (data as PrintFile | null) ?? null;
}

export async function updatePrintJobStatus(id: string, status: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .update({ status, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  return { ...(data as Omit<PrintJob, "files">), files: await getFiles(id) };
}

export async function deletePrintJob(id: string) {
  const supabase = createSupabaseAdminClient();
  const { error: filesError } = await supabase.from(FILES_TABLE).delete().eq("jobId", id);
  throwIfError(filesError);
  const { error } = await supabase.from(JOBS_TABLE).delete().eq("id", id);
  throwIfError(error);
}

export async function createPrintJob(input: {
  name: string;
  phone: string;
  notes: string | null;
  files: Omit<PrintFile, "id" | "jobId" | "createdAt" | "enhanced">[];
}) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const { data: job, error: jobError } = await supabase
    .from(JOBS_TABLE)
    .insert({
      id: jobId,
      name: input.name,
      phone: input.phone,
      notes: input.notes,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .select("*")
    .single();
  throwIfError(jobError);

  const rows = input.files.map((file) => ({
    id: crypto.randomUUID(),
    jobId,
    ...file,
    enhanced: false,
    createdAt: now,
  }));
  const { error: filesError } = await supabase.from(FILES_TABLE).insert(rows);
  if (filesError) {
    await supabase.from(JOBS_TABLE).delete().eq("id", jobId);
    throw new Error(filesError.message);
  }

  return { ...(job as Omit<PrintJob, "files">), files: rows as PrintFile[] };
}

export async function updatePrintFile(id: string, values: Partial<PrintFile>) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(FILES_TABLE)
    .update(values)
    .eq("id", id)
    .select("*")
    .single();
  throwIfError(error);
  return data as PrintFile;
}
