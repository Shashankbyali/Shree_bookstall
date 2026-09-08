"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Download,
  FileText,
  ImageIcon,
  Loader2,
  LogOut,
  Phone,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react";
import {
  JOB_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  type JobStatus,
} from "@/lib/jobs";
import { formatBytes, isImageMime } from "@/lib/file-utils";
import { EnhanceButton } from "@/components/EnhanceButton";

type PrintFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  enhanced: boolean;
};

type PrintJob = {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  status: JobStatus;
  createdAt: string;
  files: PrintFile[];
};

export function OwnerDashboard() {
  const router = useRouter();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  const loadJobs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const qs = filter !== "all" ? `?status=${filter}` : "";
      const res = await fetch(`/api/jobs${qs}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setJobs(data.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter, router]);

  useEffect(() => {
    // The first load and the poll both run from the timer callback rather than
    // synchronously in the effect body, which would trigger cascading renders
    // (react-hooks/set-state-in-effect).
    let active = true;
    const tick = (silent: boolean) => {
      if (active) void loadJobs(silent);
    };
    const first = setTimeout(() => tick(false), 0);
    const id = setInterval(() => tick(true), 20000);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [loadJobs]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function updateStatus(jobId: string, status: JobStatus) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setJobs((prev) => prev.map((j) => (j.id === jobId ? data.job : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  }

  async function deleteJob(jobId: string) {
    if (!window.confirm("Delete this job and its files? This cannot be undone.")) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      setSelectedId(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setUpdating(false);
    }
  }

  const pendingCount = jobs.filter((j) => j.status === "pending").length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-5">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="font-display text-xl font-semibold text-ink">
            Shree BookStall
          </Link>
          <p className="text-sm text-muted">Print desk · live queue</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadJobs();
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-2 text-sm font-medium text-ink-soft hover:bg-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-2 text-sm font-medium text-ink-soft hover:bg-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${
            filter === "all"
              ? "bg-ink text-white"
              : "border border-line bg-white/70 text-ink-soft"
          }`}
        >
          All
        </button>
        {JOB_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              filter === s
                ? "bg-ink text-white"
                : "border border-line bg-white/70 text-ink-soft"
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
        {pendingCount > 0 && filter === "all" && (
          <span className="ml-auto rounded-full bg-warm/15 px-3 py-1 text-xs font-semibold text-warm">
            {pendingCount} new
          </span>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="grid flex-1 gap-5 lg:grid-cols-[1fr_1.1fr]">
        <section className="paper-card overflow-hidden rounded-3xl">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-display text-lg font-semibold">Queue</h2>
          </div>
          {loading && jobs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : jobs.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-muted">
              No print jobs yet. When a customer scans the QR and submits, they
              appear here.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(job.id)}
                    className={`flex w-full flex-col gap-1 px-4 py-3.5 text-left transition hover:bg-paper/80 ${
                      selectedId === job.id ? "bg-accent/5" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-ink">{job.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[job.status]}`}
                      >
                        {STATUS_LABELS[job.status]}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Phone className="h-3 w-3" />
                      {job.phone}
                      <span className="mx-1">·</span>
                      {job.files.length} file
                      {job.files.length !== 1 ? "s" : ""}
                      <span className="mx-1">·</span>
                      {formatDistanceToNow(new Date(job.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="paper-card rounded-3xl p-5 sm:p-6">
          {!selected ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-muted">
              <ScanLine className="mb-3 h-10 w-10 text-accent/50" />
              <p className="text-sm">Select a job to preview files and edit.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-display text-2xl font-semibold text-ink">
                    {selected.name}
                  </h2>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[selected.status]}`}
                  >
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <Phone className="h-3.5 w-3.5" />
                  <a
                    href={`tel:${selected.phone}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {selected.phone}
                  </a>
                </p>
                {selected.notes && (
                  <p className="mt-3 rounded-xl bg-paper px-3 py-2 text-sm text-ink-soft">
                    <span className="font-semibold">Notes: </span>
                    {selected.notes}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => deleteJob(selected.id)}
                  disabled={updating}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete job &amp; files
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink-soft">
                  Status
                </label>
                <select
                  value={selected.status}
                  disabled={updating}
                  onChange={(e) =>
                    updateStatus(selected.id, e.target.value as JobStatus)
                  }
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none ring-accent/30 focus:ring-2"
                >
                  {JOB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <h3 className="mb-3 font-display text-lg font-semibold">
                  Files ({selected.files.length})
                </h3>
                <ul className="space-y-3">
                  {selected.files.map((file) => (
                    <li
                      key={file.id}
                      className="rounded-2xl border border-line bg-white p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-paper p-2 text-accent">
                          {isImageMime(file.mimeType) ? (
                            <ImageIcon className="h-5 w-5" />
                          ) : (
                            <FileText className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {file.originalName}
                          </p>
                          <p className="text-xs text-muted">
                            {formatBytes(file.size)}
                            {file.enhanced ? " · edited (original kept)" : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a
                              href={`/api/jobs/${selected.id}/files/${file.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-paper"
                            >
                              Open / print
                            </a>
                            <a
                              href={`/api/jobs/${selected.id}/files/${file.id}?download=1`}
                              download={file.originalName}
                              className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-paper"
                            >
                              <Download className="h-3 w-3" />
                              Download
                            </a>
                            {isImageMime(file.mimeType) && (
                              <EnhanceButton
                                jobId={selected.id}
                                fileId={file.id}
                                fileName={file.originalName}
                                enhanced={file.enhanced}
                                fileSize={file.size}
                                onDone={() => loadJobs()}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                      {isImageMime(file.mimeType) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={`${file.id}-${file.size}-${file.enhanced}`}
                          src={`/api/jobs/${selected.id}/files/${file.id}?thumb=1&t=${file.size}`}
                          alt={file.originalName}
                          className="mt-3 max-h-56 w-full rounded-xl object-contain bg-paper"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
