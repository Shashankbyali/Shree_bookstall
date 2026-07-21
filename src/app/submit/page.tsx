"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Loader2, X } from "lucide-react";

export default function SubmitPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [jobId, setJobId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list);
    setFiles((prev) => {
      const merged = [...prev, ...next];
      return merged.slice(0, 20);
    });
    setError("");
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const form = new FormData();
      form.set("name", name);
      form.set("phone", phone);
      form.set("notes", notes);
      files.forEach((f) => form.append("files", f));

      const res = await fetch("/api/submit", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Submission failed");
      }
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
            <span className="text-xs text-muted">Up to 20 files · 25MB each</span>
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
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2 text-sm"
                >
                  <span className="truncate font-medium text-ink">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="rounded-full p-1 text-muted hover:bg-paper hover:text-ink"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
