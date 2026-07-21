export const JOB_STATUSES = [
  "pending",
  "processing",
  "ready",
  "completed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const STATUS_LABELS: Record<JobStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready for pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_COLORS: Record<JobStatus, string> = {
  pending: "bg-amber-100 text-amber-900",
  processing: "bg-sky-100 text-sky-900",
  ready: "bg-emerald-100 text-emerald-900",
  completed: "bg-zinc-100 text-zinc-700",
  cancelled: "bg-rose-100 text-rose-900",
};
