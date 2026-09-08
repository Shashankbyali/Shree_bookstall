"use client";

import { useState } from "react";
import { Download, Loader2, SlidersHorizontal, Wand2 } from "lucide-react";
import { ScanEditor } from "@/components/ScanEditor";

type Props = {
  jobId: string;
  fileId: string;
  fileName: string;
  enhanced: boolean;
  fileSize: number;
  onDone: () => void;
};

export function EnhanceButton({
  jobId,
  fileId,
  fileName,
  enhanced,
  fileSize,
  onDone,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [cacheBust, setCacheBust] = useState(fileSize);

  const printName = fileName.replace(/\.[^.]+$/, "") + "-print.jpg";
  const downloadUrl = `/api/jobs/${jobId}/files/${fileId}?download=1&v=${cacheBust}`;

  /** One tap: auto-detect the page and brighten, with default settings. */
  async function runAuto() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${fileId}/enhance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Edit failed");
      setCacheBust(data.file?.size ?? Date.now());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runAuto}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-dark disabled:opacity-60"
          title="Detect the page, crop it and brighten it"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Editing…
            </>
          ) : (
            <>
              <Wand2 className="h-3.5 w-3.5" />
              Auto crop + brighten
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-paper disabled:opacity-60"
          title="Adjust the crop and brightness by hand"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Adjust…
        </button>
        {enhanced && (
          <a
            href={downloadUrl}
            download={printName}
            className="inline-flex items-center gap-1.5 rounded-full bg-warm px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            Download for print
          </a>
        )}
      </div>
      {error && <span className="text-[11px] text-rose-700">{error}</span>}

      {editing && (
        <ScanEditor
          jobId={jobId}
          fileId={fileId}
          fileName={fileName}
          enhanced={enhanced}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setCacheBust(Date.now());
            onDone();
          }}
        />
      )}
    </div>
  );
}
