"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { MAX_FILES, MAX_FILE_SIZE, formatBytes } from "@/lib/upload-limits";

type Upload = {
  storedName: string;
  originalName: string;
  mimeType: string;
  size: number;
  signedUrl: string;
};

/**
 * Send one file straight to Supabase Storage.
 *
 * XHR rather than fetch because it reports upload progress, which matters when a
 * customer is pushing 20MB of photos over mobile data.
 */
function putFile(url: string, file: File, contentType: string, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

export default function SubmitPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [jobId, setJobId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.find((f) => f.size > MAX_FILE_SIZE);
    if (tooBig) {
      setError(`${tooBig.name} is too large (max ${formatBytes(MAX_FILE_SIZE)}).`);
      return;
    }
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES));
    setError("");
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setProgress(0);

    try {
      // 1. Ask the server for one signed upload URL per file. Vercel functions
      //    cannot accept the files themselves (4.5MB request body cap).
      const signRes = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) throw new Error(signData.error || "Could not start the upload");

      const uploads: Upload[] = signData.uploads;

      // 2. Upload directly to storage, tracking overall progress by bytes.
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
      const sent = new Array(files.length).fill(0);
      await Promise.all(
        uploads.map((upload, i) =>
          putFile(upload.signedUrl, files[i], upload.mimeType, (fraction) => {
            sent[i] = fraction * files[i].size;
            setProgress(sent.reduce((a, b) => a + b, 0) / totalBytes);
          })
        )
      );

      // 3. Record the job. Only metadata crosses the wire here.
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, notes, ticket: signData.ticket }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");

      setJobId(data.jobId);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-full max-w-lg flex-1 flex-col justify-center px-5 py-12">
        <div className="paper-card animate-fade-up rounded-3xl p-8 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-accent" />
          <h1 className="font-display mt-4 text-3xl font-semibold text-ink">
            Sent to Shree BookStall
          </h1>
          <p className="mt-3 text-muted">
            Your print request is with the shop. They&apos;ll call{" "}
            <span className="font-semibold text-ink">{phone}</span> when ready.
          </p>
          <p className="mt-2 text-xs text-muted">Ref: {jobId.slice(0, 8)}</p>
          <button
            type="button"
            onClick={() => {
              setDone(false);
              setName("");
              setPhone("");
              setNotes("");
              setFiles([]);
              setJobId("");
              setProgress(0);
            }}
            className="btn-primary mt-8 inline-flex rounded-full px-6 py-3 text-sm font-semibold"
          >
            Send another
          </button>
          <Link
            href="/"
            className="mt-4 block text-sm font-medium text-accent hover:underline"
          >
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-5 py-8 sm:py-12">
      <Link href="/" className="text-sm font-medium text-accent hover:underline">
        ← Shree BookStall
      </Link>
      <h1 className="font-display mt-4 text-3xl font-semibold text-ink sm:text-4xl">
        Send for print
      </h1>
      <p className="mt-2 text-muted">
        Enter your details and upload the files you need printed.
      </p>

      <form onSubmit={onSubmit} className="paper-card mt-8 space-y-5 rounded-3xl p-6 sm:p-8">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
            Your name
          </span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-line bg-white px-4 py-3 outline-none ring-accent/30 focus:ring-2"
            placeholder="e.g. Rahul Sharma"
            autoComplete="name"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
            Phone number
          </span>
          <input
            required
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-line bg-white px-4 py-3 outline-none ring-accent/30 focus:ring-2"
            placeholder="10-digit mobile"
            autoComplete="tel"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
            Notes <span className="font-normal text-muted">(optional)</span>
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full resize-none rounded-xl border border-line bg-white px-4 py-3 outline-none ring-accent/30 focus:ring-2"
            placeholder="Color / B&W, copies, page numbers…"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
            Files
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-paper/80 px-4 py-8 text-center transition hover:border-accent hover:bg-white"
          >
            <FileUp className="h-7 w-7 text-accent" />
            <span className="text-sm font-semibold text-ink">
              Tap to upload PDF, images, docs…
            </span>
            <span className="text-xs text-muted">
              Up to {MAX_FILES} files · {formatBytes(MAX_FILE_SIZE)} each
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {files.length > 0 && (
            <>
              <ul className="mt-3 space-y-2">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  >
                    <span className="truncate font-medium text-ink">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted">{formatBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      disabled={loading}
                      className="rounded-full p-1 text-muted hover:bg-paper hover:text-ink disabled:opacity-40"
                      aria-label="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                {files.length} file{files.length !== 1 ? "s" : ""} · {formatBytes(totalSize)} total
              </p>
            </>
          )}
        </div>

        {loading && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-paper">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Uploading… {Math.round(progress * 100)}%
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || files.length === 0}
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Submit for print"
          )}
        </button>
      </form>
    </main>
  );
}
